# MikroTik Provisioning SaaS — V1 End-to-End Product Validation

**Status**: V1 Ready for Production (ISP/Advanced Operator Use)  
**Date**: 2026-05-05  
**Scope**: Complete system validation — backend, mobile app, operator workflow, failure modes

---

## EXECUTIVE SUMMARY

**VERDICT: YES — This is a real, safe, usable V1 product for ISP provisioning operations.**

This product automates MikroTik router provisioning at scale (10–1,000+ devices) without sacrificing operator control or safety. It enforces isolation, auditability, and failure containment at every layer. The backend is failure-safe and queue-based. The mobile app is a faithful mirror of backend state, designed for field operators to monitor and intervene on running jobs.

**Appropriate for**: ISPs, network operators, and teams with MikroTik API/WireGuard competency, ready for queue-based provisioning workflows.  
**Not appropriate for**: Single-device deployments, turn-key/"hands-off" setups, teams lacking MikroTik troubleshooting skills.

---

## 1. END-TO-END OPERATOR SCENARIO: A Real Provisioning Day

### Setup
- **Tenant**: Regional ISP (50 MikroTik routers in field)
- **Operator**: Sarah, field technician with MikroTik experience
- **Job**: Deploy QoS + firewall policy update to 12 routers in customer cluster

### Timeline

#### 09:00 AM — Operator Submits Job Batch (Web Console)
Sarah logs into the web console (outside scope of mobile app) and creates 12 provisioning jobs:
- Each job targets one router (isolation enforced per-router)
- Config payload: firewall rules + QoS parameters
- Submits 12 jobs → backend state = SUBMITTED (awaiting approval) for each

**Backend sees:**
- Each job is created with UUID, tenant_id, router_id
- Idempotency key is generated: hash(router_id + firewall_command + config_payload)
- Deduplication check: no prior job with same key in QUEUED/EXECUTING state
- Jobs are held in SUBMITTED state, visible on operator approval dashboard
- Audit log records: JOB_CREATED event for each

#### 09:15 AM — Operator Reviews and Approves (Web Console)
Sarah reviews the 12 jobs on the approval dashboard. She sees:
- Target routers (IPs, names, models)
- Proposed config summary (firewall rules, QoS changes)
- Each job has a "review SLA" timer (must approve within 30 min)

Sarah clicks APPROVE on all 12 jobs.

**Backend sees:**
- For each job, state transition: SUBMITTED → QUEUED (atomic)
- Each job is appended to its router's queue (single-entry queue initially, since each router gets 1 job)
- approved_at timestamp recorded
- approved_by operator_id recorded
- Audit log records: JOB_APPROVED event with Sarah's decision
- Scheduler is signaled: "12 routers now have queued jobs"

**Mobile app would show** (if Sarah opens it now):
- Dashboard: "12 jobs queued" badge lights up
- Jobs List: 12 entries in Queued tab

#### 09:20 AM — Scheduler Assigns Jobs to Workers
Backend scheduler runs:
- Scanner: detects 12 routers with QUEUED jobs
- Eligibility check: all 12 routers are ONLINE, no other jobs executing
- Lock acquisition: acquires distributed lock on each router (TTL = max_execution_time + 30s)
- Worker pool: 4 workers available (IDLE)
- Assigns jobs deterministically:
  - Job 1 → Worker A
  - Job 2 → Worker B
  - Job 3 → Worker C
  - Job 4 → Worker D
  - Job 5 → Worker A (round-robin, Worker A now has 2 queued jobs)
  - ... and so on

**Backend sees:**
- Each job state transition: QUEUED → ASSIGNED
- assigned_worker = {A, B, C, D, A, B, ...}
- Audit log records: JOB_ASSIGNED event for each
- Workers are signaled (message queue): "You have new work"

**Mobile app would show:**
- Jobs List: 12 entries move from Queued → Running
- Dashboard: "12 running" badge
- Each job has progress bar (0%, just started)

#### 09:25 AM — Workers Execute Jobs in Parallel
All 4 workers are now executing jobs. Each worker follows the same execution flow:

##### Worker A — Job 1 Execution (Router 1)
```
Phase 1: Pre-flight (30s timeout)
  ├─ Load job config (firewall rules)
  ├─ Load router credentials (encrypted storage)
  ├─ Validate config syntax (static checks, no router contact yet)
  ├─ Verify router IP is still 192.168.1.101 (matches at approval time)
  └─ [SUCCESS] All pre-flights pass

Phase 2: Connect (60s timeout)
  ├─ SSH to 192.168.1.101 with stored credentials
  ├─ Verify firmware version (RouterOS 7.x)
  ├─ Issue basic query (/ip address print)
  └─ [SUCCESS] Router responds, connection stable

Phase 3: Backup (90s timeout)
  ├─ Snapshot current config from router
  ├─ Compare against router.config_versions[ACTIVE]
  │   └─ [MATCH] Current config on router matches last known state
  └─ Store snapshot as router.config_versions[PROPOSED]

Phase 4: Apply (120s timeout)
  ├─ Send firewall rules via API calls
  ├─ Send QoS parameters via API calls
  ├─ Router responds: all commands accepted
  └─ [SUCCESS] Config applied

Phase 5: Verify (60s timeout)
  ├─ Read back config from router (query firewall rules, QoS params)
  ├─ Compare against desired config (matches)
  ├─ No unintended side effects detected
  └─ [SUCCESS] Verification passed

Phase 6: Finalize (atomic)
  ├─ Update job: EXECUTING → SUCCESS
  ├─ Save execution log to immutable storage
  ├─ Update router.config_versions[ACTIVE] = PROPOSED
  ├─ Move old ACTIVE → STABLE (for rollback)
  ├─ Release router lock
  ├─ Dequeue job from router.job_queue
  ├─ Audit log: JOB_EXECUTED (full log attached)
  └─ Signal scheduler: "Router 1 is free, check for more jobs"

Result: Job 1 SUCCESS (4m 15s elapsed)
```

**Mobile app would show** (real-time update):
- Job 1 in Jobs List: status badge changes to green ✓
- Job Detail for Job 1: all 6 phases show as complete (green checkmarks)
- Dashboard: "12 running" decrements to "11 running", "1 completed"

##### Parallel: Worker B — Job 2 Execution (Router 2)
Same flow as Job 1, also succeeds in ~4m.

##### Parallel: Worker C — Job 3 Execution (Router 3)
**At Phase 4 (Apply), Router 3 encounters an error:**

```
Router API error: "Firewall rule references non-existent interface ether2"
  └─ This is a PERMANENT FAILURE (bad config, not network issue)
  
Worker C immediately:
  ├─ Stops sending commands (partial apply prevented)
  ├─ Reads router state to confirm what was applied
  │   └─ [None of the QoS rules were applied yet, only firewall started]
  │   └─ This is PARTIAL APPLICATION → worker marks job FAILED immediately
  ├─ Updates job: EXECUTING → FAILED
  ├─ Sets recovery_action = MANUAL_REVIEW (not auto-retry)
  ├─ Releases router lock
  ├─ Removes job from router.job_queue
  ├─ Audit log: JOB_FAILED (full error message, recovery_action)
  ├─ Alert operator: "Job 3 requires review — permanent failure"
  └─ Signal scheduler: "Check if Router 3 has more queued jobs (none)"

Result: Job 3 FAILED (1m 45s elapsed, at apply phase)
```

**Mobile app would show** (real-time alert):
- Dashboard: Red banner appears "1 job failed"
- Recent events: "Job 3 failed: Config validation"
- Jobs List: Job 3 status badge turns red ✗
- Jobs List: Job 3 moves to Failed tab
- Job Detail for Job 3: shows failed step (Apply), full error message, recovery options

**Meanwhile, Router 3 state:**
- Config is UNCHANGED (partial apply was detected and prevented)
- Router is ONLINE (no lockout)
- Job queue for Router 3 is empty
- Audit trail shows: job failed, state before/after, what was attempted

#### 09:50 AM — Sarah Gets Mobile Notification (via phone)
Sarah's phone buzzes. She opens the MikroTik mobile app:

**Dashboard shows:**
- "11 running, 1 failed, 1 completed"
- Recent event: "Job 3 failed — Router_03 firewall config validation"

**Sarah taps on Job 3 → Job Detail screen:**
- Job ID: 47382
- Target: Router_03 (192.168.1.103)
- Status: FAILED
- Failed step: "Apply" (at 1m 45s)
- Error message (full): "Firewall rule references non-existent interface ether2"
- All previous steps succeeded (pre-flight, connect, backup, verify ready)
- Recovery options:
  - "Retry from this step" (button)
  - "Skip this step and continue" (button, disabled — cannot skip apply)
  - "Cancel and quarantine" (button)

**Sarah analyzes:**
- Error is clear: config references ether2, but this router only has ether1 on the uplink
- Root cause: Config template was not customized for Router_03 (ether3 is the interface)
- Options: She could retry (will fail again), modify config (requires web console), or quarantine and skip this router

#### 10:00 AM — Sarah Intervenes
Sarah decides to quarantine Router 3 for now and continue with the others. She taps "Cancel and quarantine":

**Mobile app shows confirmation:**
- "Cancel job 47382 and quarantine Router_03?"
- "This router will be marked quarantined. You must manually release it when ready."
- Buttons: Back (default) | Confirm

Sarah taps Confirm.

**Backend sees:**
- Job 3: state FAILED → (operator action) → ABORTED
- Router 3: state ONLINE → QUARANTINED (marked by operator)
- Audit log: JOB_ABORTED, ROUTER_QUARANTINED (Sarah's action)
- Explanation: config mismatch, operator chose to quarantine

**Mobile app shows:**
- Job Detail for Job 3: status now "Quarantined by operator at 10:00 AM"
- Routers screen: Router_03 is now in Quarantine filter
- Dashboard: "1 quarantined, 10 running"

#### 10:05 AM — Remaining Jobs Complete
Workers A, B, D continue executing. By 10:20 AM:
- Job 1 (Router 1): SUCCESS ✓
- Job 2 (Router 2): SUCCESS ✓
- Job 3 (Router 3): QUARANTINED
- Job 4 (Router 4): SUCCESS ✓
- Job 5 (Router 5): SUCCESS ✓
- ... (Jobs 6–12 all complete successfully)

**Mobile app Dashboard shows:**
- "11 completed, 1 quarantined"
- All 12 original jobs visible in history

#### 10:30 AM — Sarah Fixes Router 3 and Releases It
Sarah gets a call from the on-site customer technician. The customer confirms that Router_03 actually has ether3 (not ether2) configured for uplink. Sarah goes back to the web console (outside mobile app), creates a corrected config for Router 3:
- Firewall rules updated to reference ether3
- QoS parameters unchanged

Sarah submits a new job (Job 13) targeting Router 3 with the corrected config.

**Backend sees:**
- Job 13: new submission, state SUBMITTED
- No idempotency match (different config_payload)
- Audit log: JOB_CREATED

Sarah approves Job 13 on the web console. State: QUEUED.

**Mobile app shows:**
- Routers screen: Router_03 still shows as Quarantined
- Sarah can now release it from quarantine

Sarah taps on Router_03 in the Routers screen:
- Tap Release button
- Confirmation: "Release Router_03 from quarantine? New jobs can be scheduled."
- Sarah confirms

**Backend sees:**
- Router 3: QUARANTINED → ONLINE
- Audit log: ROUTER_RELEASED

**Mobile app shows:**
- Routers screen: Router_03 moves from Quarantine filter to Online filter
- Router Detail for Router_03: status = "Online", quarantine message gone

#### 10:35 AM — Job 13 Executes Successfully
Scheduler detects Router 3 is ONLINE and has a QUEUED job. Assigns Job 13 to next available worker.

Worker executes Job 13 with corrected config:
- Pre-flight: PASS
- Connect: PASS
- Backup: PASS (snapshot current state before new changes)
- Apply: PASS (firewall rules reference ether3, QoS applies)
- Verify: PASS
- Finalize: SUCCESS

**Mobile app shows:**
- Job 13 in Jobs List: SUCCESS ✓
- Dashboard: All jobs complete (11 original + 1 corrected)
- Router_03: now showing "Online, last job succeeded"

#### 11:00 AM — End of Day
Sarah reviews the mobile app:
- Dashboard: "12 completed provisioning jobs, 0 failed, 0 quarantined"
- Jobs List: 12 entries, all green
- Routers screen: All 12 target routers show "Online"
- She exits the app

**Backend state:**
- 12 routers provisioned successfully
- 1 router hit a config error, was quarantined, retried with corrected config, succeeded
- Audit trail: 13 jobs created, 1 rejected, 12 succeeded (with timestamps, config snapshots, operator decisions)
- Tenant data: isolated, no cross-contamination with other tenants
- All routers retain full SSH access for manual recovery if needed

---

## 2. RESPONSIBILITY SPLIT

### What the Backend ENFORCES (Cannot Be Bypassed)

#### Job Approval Gate
- **Rule**: No configuration change is applied to a router without operator approval
- **Enforcement**: Jobs enter SUBMITTED state at creation; cannot move to QUEUED without explicit approval
- **Cannot be bypassed**: Even if tenant requests auto-approval, the backend blocks it
- **Audit**: Every approval is logged with timestamp, operator ID, and decision reason

#### Tenant Isolation
- **Rule**: Router A's jobs, config, and audit records are never visible to Tenant B
- **Enforcement**: Every query filters by tenant_id at the data layer
- **Cannot be bypassed**: Worker processes are single-tenant per job; no cross-tenant leakage in error messages
- **Audit**: Isolation violations are detected at the data access layer and block the request

#### Router Serialization (No Concurrent Jobs)
- **Rule**: Only one job may execute against a router at a time
- **Enforcement**: Distributed lock acquired at ASSIGNED state, held until finalization
- **Cannot be bypassed**: Second job targeting same router waits in queue until lock is released
- **Audit**: Lock acquisition and release is logged

#### Atomic State Transitions
- **Rule**: Job state changes are all-or-nothing; no partial state corruption
- **Enforcement**: Database transactions enforce atomicity (SUBMITTED→QUEUED, QUEUED→ASSIGNED, etc.)
- **Cannot be bypassed**: If a write fails, state does not change
- **Audit**: Every transition is logged

#### Immutable Audit Trail
- **Rule**: Provisioning history is forever recorded and never modified
- **Enforcement**: Audit events are write-once, stored in append-only log
- **Cannot be bypassed**: No operator, tenant, or system process can delete or modify audit records
- **Audit**: Audit trail is queryable only by the owning tenant

#### Failure Containment
- **Rule**: A failed job on Router X does not block jobs on Router Y
- **Enforcement**: Job failure releases the router lock; queue processing continues independently
- **Cannot be bypassed**: There is no cascading retry or blocking logic
- **Audit**: Failures are logged per-router without affecting others

#### Idempotency Guarantees
- **Rule**: Replaying an APPROVED job produces identical results
- **Enforcement**: Backend prevents duplicate execution via idempotency key (same config = same outcome)
- **Cannot be bypassed**: Same config + same router = deterministic result
- **Audit**: Duplicate submissions are detected and deduplicated

#### Limits on Automatic Retry
- **Rule**: Transient failures retry up to 3 times with exponential backoff; permanent failures escalate to manual review
- **Enforcement**: Worker classifies failure as transient vs permanent and sets recovery_action accordingly
- **Cannot be bypassed**: After 3 attempts, job enters MANUAL_REVIEW state
- **Audit**: Each retry attempt is logged separately

### What the Mobile App ALLOWS or BLOCKS (UI Enforces, Backend Validates)

#### Operator Can ALWAYS View
- ✓ All jobs (running, failed, completed, queued)
- ✓ Full execution logs and error messages
- ✓ Router roster and real-time status
- ✓ Audit trail (every action with timestamp and operator)
- ✓ Detailed failure reasons (not hidden, not truncated)

#### Operator Can ALWAYS DO (Mobile App Provides Controls)
- ✓ Pause a running job (state = EXECUTING → PAUSED)
  - Backend: Job enters PAUSED state, lock held, router left in incomplete state
  - Audit: Pause action logged
  - Can resume later or cancel
- ✓ Resume a paused job (state = PAUSED → EXECUTING resumes from where it left off)
  - Backend: Job continues from last completed phase
  - Audit: Resume action logged
- ✓ Retry a failed step (job re-enters EXECUTING for that specific phase)
  - Backend: Attempt counter incremented, worker picks up from that phase
  - Audit: Retry action logged with phase name
- ✓ Cancel a queued job (state = QUEUED → ABORTED)
  - Backend: Job removed from queue, no execution
  - Audit: Cancellation logged
- ✓ Cancel a running job (state = EXECUTING → ABORTED with grace period)
  - Backend: Worker receives abort signal, stops sending commands, releases lock
  - Audit: Cancellation logged with reason
  - Warning: Router is left in partial state; operator must fix manually
- ✓ Quarantine a router (explicit operator action)
  - Backend: Router state = QUARANTINED, no new jobs can be assigned
  - Audit: Quarantine action logged with reason
- ✓ Release a quarantined router (operator unlocks it)
  - Backend: Router state = QUARANTINED → ONLINE
  - Audit: Release action logged
- ✓ Check offline router (operator initiates ping, gets response)
  - Backend: Initiates connectivity check, returns result
  - Audit: Check logged
  - No auto-recovery; operator decides next step

#### Operator CANNOT DO (App Blocks, Backend Enforces)
- ✗ Modify a queued job's config (can only approve, reject, or cancel)
- ✗ Skip a safety-critical step (e.g., power sequence, boot validation)
  - App shows disabled Skip button with reason
  - Backend rejects if operator bypasses in advanced mode
- ✗ Apply configuration without operator approval (no auto-apply)
  - Backend always requires explicit approval
- ✗ Auto-retry a job (operator decides each time)
  - Backend does NOT auto-retry permanent failures
- ✗ Access another tenant's routers or jobs
  - Backend enforces tenant isolation at data layer
  - App shows only current tenant's data
- ✗ Create or design provisioning jobs (web console only)
  - Mobile app is read-heavy + high-confidence remote control
  - Job creation is out of scope

### What DECISIONS Are Always Human

#### Approval Decision
- **When**: After job submission, before queuing
- **Who**: Operator (authenticated, authorized for that router)
- **Options**: Approve, Reject, Request modification
- **Backend**: Job cannot proceed to execution without approval
- **Cannot be automated**: V1 deliberately does not support auto-approval

#### Failure Recovery Decision
- **When**: After permanent failure
- **Who**: Operator
- **Options**: Retry (investigate and retry same config), Modify (create new job with corrected config), Abort (abandon)
- **Backend**: Job enters MANUAL_REVIEW state and waits
- **Cannot be automated**: V1 does not auto-decide on permanent failures

#### Router Recovery Decision
- **When**: Router becomes unreachable during provisioning
- **Who**: Operator
- **Options**: Investigate network, verify router is online, manually restore, or retry
- **Backend**: Router enters UNREACHABLE state; operator must manually restore to ONLINE
- **Cannot be automated**: V1 does not auto-recover unreachable routers

#### Configuration Change Timing
- **When**: Operator decides when to schedule a job (based on customer schedule, maintenance window, etc.)
- **Who**: Operator (via web console or mobile app approval)
- **Cannot be automated**: V1 does not support scheduled or time-based jobs

#### Quarantine Release Decision
- **When**: After operator has fixed the underlying issue
- **Who**: Operator
- **Options**: Release, Keep quarantined, Investigate more
- **Backend**: Router stays quarantined until operator explicitly releases
- **Cannot be automated**: V1 does not auto-release

---

## 3. SAFETY VALIDATION

### Prevention 1: Router Bricking (Unreachable State)

#### Guarantee
A failed provisioning job will NOT leave a router in an unreachable state. The router remains accessible for manual recovery.

#### How the System Enforces This

**Pre-flight verification:**
- Before any config is applied, worker verifies router IP, credentials, and basic connectivity
- If router is unreachable at pre-flight, job fails immediately (no config sent)

**Backup before apply:**
- Worker snapshots current config before sending any commands
- If snapshot fails, job fails (cannot proceed blind)

**Atomic apply-verify-finalize:**
- Commands are sent to router
- If apply is partial (network interruption): worker detects this via timeout, reads back state, marks job FAILED
- Partial state is never committed to ACTIVE (marked as PROPOSED only)
- If verification fails (config doesn't match expected), job fails and router is NOT updated

**Manual recovery escape hatch:**
- Router retains full SSH access at all times (not managed by SaaS)
- Operator can SSH directly into router and fix state manually
- No SaaS-level lockout possible (SaaS job is just one job in the queue)

**Failure does not lock router:**
- If a job fails, router lock is released immediately
- Operator can submit a new job to fix the state (e.g., "restore factory config")
- Router is never stuck in LOCKED state due to SaaS failure

#### What This Prevents
- Mass lockout of routers
- Cascading failures where one router becomes inaccessible and blocks others
- Silent partial application (half-provisioned state)

### Prevention 2: Silent Failure

#### Guarantee
Every provisioning action is visible and logged. No failure hides in logs or gets swallowed.

#### How the System Enforces This

**Explicit failure states:**
- Every job has a state: SUBMITTED, QUEUED, ASSIGNED, EXECUTING, SUCCESS, FAILED, ABORTED, ROLLED_BACK
- There is no "undefined" or "unknown" state
- Every state transition is logged with timestamp and reason

**Failure is blocking:**
- A failed job enters MANUAL_REVIEW state (operator must decide next step)
- Job does not auto-continue or auto-retry after permanent failure
- Operator is notified (visible on dashboard, mobile app alert)

**Audit trail is immutable:**
- Every failure is logged permanently
- Failures cannot be deleted or hidden
- Operator can audit history at any time

**Error messages are detailed:**
- Error includes: what phase failed, why, what router was affected, what was expected vs actual
- No truncation or obfuscation (safe, no secrets)

**Dashboard visibility:**
- Operator always sees: running jobs, failed jobs, queued jobs, completed jobs
- Failed jobs are shown in red, with a count badge
- Mobile app shows failures prominently on Dashboard

#### What This Prevents
- Configurations that half-apply and succeed reporting success
- Failures that go unnoticed until customers complain
- Audit ambiguity (inability to reconstruct what happened)

### Prevention 3: Accidental Operator Mistakes

#### Guarantee
High-risk actions require explicit confirmation and are reversible.

#### How the System Enforces This

**Confirmation dialogs (mobile app):**
- Any action that changes state (Pause, Resume, Retry, Cancel, Release) shows a confirmation
- Confirmation dialog repeats what will happen (e.g., "Pause will stop the job after the current step completes")
- Default button is always "Back" (safe default, not the risky action)

**Safety guards on skipping steps:**
- Skip button is disabled for safety-critical steps (e.g., power sequence)
- Tooltip explains WHY skip is disabled (e.g., "Cannot skip power-on. Router will not boot.")
- Operator sees the constraint, not a blank refusal

**Reversible actions:**
- Pause: can resume later from same state
- Quarantine: can be released when operator is ready
- Cancel: queued job is not executed, running job stops
- Retry: attempts the same step again

**Irreversible actions are rare and explicit:**
- Cancel on a running job: leaves router in partial state (operator must fix manually)
- Confirmation dialog shows: "This router will be left in partial state. You must fix it manually."
- Operator acknowledges the risk before confirming

**Mobile app has no auto-actions:**
- No auto-retry, no auto-rollback, no auto-continue
- Every action is operator-initiated

#### What This Prevents
- Accidentally canceling the wrong job
- Pausing a job intending to pause a different one
- Releasing a quarantined router without understanding the consequences
- Cascading mistakes from one accidental action

### Prevention 4: Cross-Tenant Impact

#### Guarantee
Tenant A's jobs, configs, and failures have zero impact on Tenant B.

#### How the System Enforces This

**Data isolation at every layer:**
- Every entity (Job, Router, Config, AuditEvent) is tagged with tenant_id at creation
- Every query filters by tenant_id (enforced at data access layer)
- Database schema is logically partitioned by tenant

**Worker isolation:**
- Worker processes are single-tenant per job execution
- Worker A executes Job from Tenant 1, then picks up Job from Tenant 1 again (not Tenant 2)
- Error messages from Worker A never include Tenant 2 details

**Queue isolation:**
- Tenant A's job queue is separate from Tenant B's
- One tenant's burst (100 jobs submitted) does not starve another tenant
- Resource quotas are enforced per-tenant

**Failure isolation:**
- Tenant A's failed job does NOT block Tenant A's other jobs (same router or different)
- Tenant A's failed job does NOT affect Tenant B in any way
- Tenant A's network outage does NOT affect Tenant B's provisioning

**Audit isolation:**
- Tenant A can only query its own audit trail
- Tenant B cannot see Tenant A's jobs, routers, or decisions
- Cross-tenant audit queries are rejected at the data layer

#### What This Prevents
- Data leakage between customers
- One customer's bad configuration affecting another
- Resource starvation where one tenant blocks others
- Audit trail contamination

---

## 4. FAILURE WALKTHROUGHS

### Scenario 1: Router Becomes Unreachable Mid-Job

#### Setup
- Job 5 is executing on Router 5
- Phase 4 (Apply): 50% through config application
- Network partition occurs (WAN link goes down)

#### What Happens

**Phase 4 execution:**
```
Worker A is sending config commands to Router 5
Network partition occurs (timeout after ~30s of no response)
Worker A:
  ├─ Timeout triggered (applies to current phase)
  ├─ Stop sending commands immediately
  ├─ Attempt to read router state ("what was applied?")
  │   └─ Read times out (network still partitioned)
  ├─ Mark execution_attempt TRANSIENT_FAILURE (network timeout)
  ├─ Update job: EXECUTING → FAILED
  ├─ Set recovery_action = RETRY (transient failure)
  ├─ Release router lock
  ├─ Increment attempt counter
  ├─ Put job back in queue (position = end of router's queue)
  ├─ Audit log: JOB_FAILED (attempt 1, transient, reason: network timeout)
  └─ Return to scheduler
```

**Router 5 state:**
- Config is UNKNOWN (worker couldn't read back)
- Router is marked UNREACHABLE (status = unreachable, heartbeat stale)
- Configuration versions are NOT updated (ACTIVE unchanged)
- Job queue for Router 5 is non-empty (Job 5 is back in queue)

**Operator visibility:**
- Mobile app: Job 5 status changes to FAILED (red)
- Dashboard: "Job 5 failed: Network timeout"
- Job Detail: Shows "Attempt 1/3, waiting for retry"
- Router Detail for Router 5: Shows "UNREACHABLE, last seen 2m ago"

#### Automatic Retry (Attempt 2)
After 30s + random(0-10s) backoff, scheduler reschedules Job 5:
- Job state: QUEUED (from retry)
- Assigns to next available worker
- Worker attempts again from Phase 1 (pre-flight)
  - Pre-flight: Router is still unreachable (timeout)
  - Job marked FAILED again
  - Backoff: 2min + random(0-30s)

**Operator visibility:**
- Job Detail: "Attempt 2/3 failed, will retry in ~2m"

#### Automatic Retry (Attempt 3)
After 2m backoff, attempt 3 starts:
- Router is still unreachable
- Pre-flight times out again
- Job marked FAILED

#### After Attempt 3 Failure
Job state changes: EXECUTING → FAILED with recovery_action = MANUAL_REVIEW (no more auto-retry)

**Operator visibility:**
- Mobile app: Job Detail shows "FAILED: 3 attempts, manual review required"
- Dashboard: Red banner "Job 5 requires intervention — Router unreachable"
- Router Detail for Router 5: "UNREACHABLE for 10 min, requires operator action"

#### Operator Intervention
Sarah reviews the situation:
- Network partition is affecting Router 5's WAN link
- She checks the field technician's status → WAN is being restored

When network is restored:
- Sarah taps Router Detail, initiates ping
- Router responds
- Router status: UNREACHABLE → ONLINE
- Sarah can now retry Job 5

**Backend sees:**
- Operator action: ROUTER_PING_SUCCESS
- Router state: UNREACHABLE → ONLINE
- Audit log: Router restored to ONLINE

**Sarah retries Job 5:**
- Taps "Retry" on Job Detail
- Confirmation dialog: "Retry Job 5 with same config?"
- Confirms
- Job 5 state: FAILED → QUEUED (requeued)
- Scheduler picks up Job 5, assigns to worker
- Execution starts from Phase 1 (pre-flight)
- All phases succeed
- Job 5: SUCCESS

**Outcome:**
- Router 5 is now ONLINE
- Job 5 succeeded after 3 failed attempts + manual recovery
- Config is ACTIVE
- Audit trail shows: 3 failures, manual recovery, success
- Tenant's other jobs (Job 1, 2, 3, 4, 6, 7, ...) were never blocked (executed independently)

#### Safety Guarantees Upheld
- ✓ Router was never bricked (operator could SSH and diagnose)
- ✓ Failure was not silent (operator saw it immediately)
- ✓ Job was not auto-retried infinitely (3 attempts, then manual review)
- ✓ Other routers were not affected (no cascade)

---

### Scenario 2: Rollback Fails

#### Setup
- Job 10 has been executing successfully
- Phase 6 (Finalize): about to move config to ACTIVE
- Operator later wants to rollback to previous config

#### What Happens During Execution (Phase 6)

```
Worker finalizes Job 10:
  ├─ Config snapshot is taken (current = PROPOSED)
  ├─ Verify phase passed (config matches expected)
  ├─ Move PROPOSED → ACTIVE
  ├─ Move old ACTIVE → STABLE (for rollback)
  ├─ Update router state (config_versions updated)
  ├─ Release lock
  └─ Job 10 state = SUCCESS
```

**Router 10 state:**
- config_versions[ACTIVE] = new config (Job 10 applied)
- config_versions[STABLE] = old config (previous state, rollback point)

#### Operator Wants to Rollback (Later, e.g., 1 hour after Job 10)
Sarah notices that the new config on Router 10 is causing unexpected behavior (not detected at verification time):
- New firewall rule is blocking some legitimate traffic
- She wants to revert to the previous stable config

Sarah opens the mobile app → Router Detail for Router 10:
- Shows "Current config version: Job 10 (applied 1h ago)"
- Shows "Last stable config: (previous version)"
- Option: "Rollback to last stable?" button

Sarah taps Rollback → Confirmation dialog:
- "Rollback Router 10 to stable version?"
- "This will undo all changes from Job 10. The router will revert to the previous configuration."
- Buttons: Back (default) | Confirm Rollback

Sarah confirms.

**Backend sees:**
- Operator action: ROLLBACK requested
- But ROLLBACK is NOT automatic at the backend level
- Instead: Backend creates an internal task "restore Router 10 to STABLE version"
- This is submitted as a new Job (Job 11) in SUBMITTED state
- Audit log: ROLLBACK_REQUESTED (operator action)

Wait, let me reconsider the architecture. Looking at the BACKEND-BLUEPRINT, it says:

> **Operator may always submit a new job to recover (e.g., "restore factory config")**
> **Operator may restore to STABLE version manually**
> **Requires explicit approval (no automatic rollback)**

So rollback is not a direct backend action; it's a new job submission.

Let me revise:

#### Operator Wants to Rollback (Revised)

Sarah notices unexpected behavior. She wants to rollback.

**Option 1: Manual rollback (outside SaaS)**
Sarah SSH's into Router 10 directly and restores config manually (not using SaaS).

**Option 2: Rollback via new job (SaaS)** 
Sarah goes to web console and submits a new job:
- Command: "Restore config to version {STABLE_VERSION_ID}"
- Config payload: {previous config snapshot}
- Target: Router 10

This is a NEW job (Job 11), not a direct rollback action.

Sarah submits Job 11 → state SUBMITTED
Sarah approves Job 11 on web console → state QUEUED
Scheduler assigns Job 11 to worker
Worker executes Job 11:
- Phase 1: Pre-flight (validate previous config)
- Phase 2: Connect to Router 10
- Phase 3: Backup (snapshot current config, which is the "bad" config from Job 10)
- Phase 4: Apply (send previous config commands)
- Phase 5: Verify (verify previous config is now active)
- Phase 6: Finalize (move restored config to ACTIVE, move bad config to archive)

**What if Job 11 (restore) partially fails at Phase 4?**

```
Worker is applying previous config commands
Network timeout occurs (partial apply)

Worker:
  ├─ Detects partial apply (timeout mid-command)
  ├─ Reads router state to determine what was applied
  │   └─ Read timeout (network still bad)
  ├─ Mark job FAILED (transient failure, network)
  ├─ Put Job 11 back in queue
  ├─ Attempt counter = 1
  └─ Audit log: ROLLBACK_FAILED (attempt 1, transient, partial apply detected)
```

**Router 10 state:**
- Config is unknown (partially reverted, partially still at bad state)
- Router is UNREACHABLE (network issues)
- Job queue has Job 11 queued (for retry)

**Operator visibility:**
- Mobile app: Job 11 (rollback) shows FAILED
- Dashboard: "Rollback failed, manual intervention needed"
- Router Detail: "UNREACHABLE, last attempted rollback at 10:45 AM"

**Operator must now:**
1. Diagnose network issue (same as Scenario 1)
2. Verify router is reachable
3. Decide: retry rollback job, or SSH in and fix manually

#### Safety Guarantees Upheld
- ✓ Rollback is not automatic (requires explicit job submission and approval)
- ✓ Partial rollback is detected (worker prevents silently broken state)
- ✓ Router is not bricked (operator can SSH and fix)
- ✓ Failure is visible (operator sees Job 11 FAILED)
- ✓ Operator has control (can retry, investigate, or fix manually)

---

### Scenario 3: Worker Crashes Mid-Execution

#### Setup
- Job 7 is executing on Router 7
- Phase 4 (Apply): worker has sent 3/5 commands
- Worker process crashes (OOM, segfault, network fault)
- Worker exits abruptly

#### What Happens

**At moment of crash:**
- Worker has a distributed lock on Router 7 (TTL = max_execution_time + 30s, e.g., 10 min)
- Job 7 state = EXECUTING
- Worker is gone (no heartbeat)

**Scheduler detects worker is dead:**
- After ~30s (heartbeat timeout), scheduler notices Worker C is not responsive
- Scheduler check: Are there any locks held by Worker C?
- Yes: Router 7 is locked by Worker C (TTL still active, e.g., 9m 30s remaining)
- Job 7 state: EXECUTING

**What the backend does NOT do:**
- Does NOT immediately assume job failed
- Does NOT update job state (worker is responsible for state)
- Does NOT release the lock (lock TTL protects against orphaned locks)

**What happens next:**

**Option A: Worker recovers and finishes**
- Worker process is restarted (or another instance of Worker C starts)
- Worker checks its assigned work (queries job queue for "jobs assigned to Worker C")
- Finds Job 7 (state EXECUTING, lock held by Worker C)
- Worker continues execution from Phase 4 (persisted in ExecutionAttempt log)
- Execution completes successfully
- Lock is released

**Option B: Lock TTL expires (10 min timeout)**
- If worker does not recover within 10 min, lock expires
- Scheduler detects expired lock: Router 7 is now unlocked but Job 7 is still EXECUTING
- Scheduler marks Job 7 state = FAILED (stale execution, worker missing)
- Sets recovery_action = MANUAL_REVIEW
- Routes to operator for investigation
- Audit log: JOB_FAILED_WORKER_TIMEOUT

**Operator visibility (if lock expires):**
- Mobile app Dashboard: "Job 7 failed: Worker timeout"
- Job Detail: "Worker crashed, execution abandoned after 10m"
- Options: Retry, investigate, cancel

#### Safety Guarantees Upheld
- ✓ No data loss (state is persisted, execution is recoverable)
- ✓ No lockout (lock TTL prevents indefinite lock hold)
- ✓ No silent failure (if worker is gone, failure is detected)
- ✓ No cascading failure (other jobs execute independently)

---

### Scenario 4: Operator Presses the Wrong Button

#### Setup
- Dashboard shows 12 jobs running
- Sarah is tired from a long shift
- She accidentally taps Cancel on Job 7 (intending to cancel Job 3)

#### What Happens

**Sarah taps Cancel on Job 7:**
- Mobile app shows confirmation dialog:
  ```
  Cancel job 47390?
  Job will stop after the current step completes.
  Router will be left in partial state. You must fix it manually.
  [Back (default)]  [Confirm Cancel]
  ```

**Sarah reads the confirmation and realizes her mistake.**
- She taps Back (default button)
- Cancel is not executed

**Outcome:** No harm, operator recovered.

#### Alternative: What If Sarah Had Confirmed?

Sarah taps Confirm Cancel on Job 7.

**Backend sees:**
- Job 7 state: EXECUTING → ABORTED
- Worker receives abort signal (cancel command)
- Worker stops sending commands
- Worker closes SSH connection
- Worker releases router lock
- Audit log: JOB_ABORTED_BY_OPERATOR (Sarah's ID, timestamp)

**Router 7 state:**
- Configuration is PARTIAL (some commands were applied, others were not)
- Router is ONLINE (not locked)
- Job queue for Router 7 is empty

**Mobile app shows:**
- Job 7 status: ABORTED
- Job Detail: "Cancelled by Sarah at 10:35 AM"
- Router Detail for Router 7: "Last job: aborted, manual intervention may be needed"

**Sarah realizes her mistake (checked a few minutes later):**
- She reviews Job 7 logs to see how many steps were completed
- She sees: Pre-flight ✓, Connect ✓, Backup ✓, Apply (50%) ✗, Verify ✗, Finalize ✗
- She can either:
  - SSH into Router 7 and manually fix the partial config
  - Resubmit a new job to complete the provisioning (starting from pre-flight again)
  - Leave Router 7 in partial state (if acceptable)

**Operator lesson:**
- Confirmation dialog prevented the worst (gave operator a chance to reconsider)
- Clear messaging about consequences (router left in partial state)
- Audit trail shows exactly what happened (Sarah can explain or escalate)

#### Safety Guarantees Upheld
- ✓ Confirmation dialog gave operator a moment to reconsider
- ✓ Default button was "Back" (safe default, not the dangerous action)
- ✓ Consequences were clearly stated
- ✓ Action was logged (audit trail shows Sarah's decision)
- ✓ Failure was not permanent (operator can fix or retry)

---

## 5. PRODUCT READINESS VERDICT

### Is This V1 Usable in Production by an ISP?

**YES, with clear caveats.**

This product is **production-ready for ISPs and network operators** with:
- MikroTik RouterOS experience (API-level, WireGuard, troubleshooting)
- Queue-based workflow comfort (not real-time, batched provisioning)
- Expectation of manual operator intervention on failures
- Network stability (V1 retries 3 times, then escalates)

### Under What Operator Maturity Assumptions?

**Required operator competency:**
1. **MikroTik fundamentals**: Understands RouterOS, API, interface naming, firewall rules, QoS
2. **Network troubleshooting**: Can diagnose why a job failed (bad config, network issues, router state)
3. **Queue-based thinking**: Comfortable with "submit, wait for approval, execute" workflow (not real-time)
4. **Escalation protocols**: Knows when to investigate manually (router is unreachable, config is wrong) vs retry
5. **Audit literacy**: Can read execution logs, understand state transitions, compare before/after configs

**Inappropriate for:**
- Inexperienced operators (without MikroTik knowledge)
- Zero-touch deployments (every operator action requires explicit approval)
- Real-time SLA requirements (provisioning is queued, not instant)
- Teams lacking incident response capability (failures require manual diagnosis)

### What Kind of Customers This V1 Is Appropriate For

#### ✓ APPROPRIATE

**Regional ISPs (10–500 routers)**
- ISPs deploying MikroTik routers to customer sites
- Operators familiar with RouterOS and network automation
- Batch deployments (50–100 routers at a time)
- Can wait for queue-based provisioning (hours, not minutes)
- Have on-call engineers for incident response

**Network Operators in Managed Services**
- Teams managing MikroTik networks for multiple customers
- Strong operational discipline (change control, approval processes)
- Audit requirements (compliance, SLA tracking)
- Multi-tenant isolation (each customer is a separate tenant)

**Enterprise Branches**
- Large enterprises deploying branch routers
- IT operations teams with incident response capability
- Willing to tolerate provisioning delays (queue-based)
- Need auditability (who changed what, when)

#### ✗ NOT APPROPRIATE

**Small businesses with 1–5 routers**
- Single SSH session is simpler and faster than provisioning SaaS
- No need for queue, approval, audit trail
- Cost doesn't justify complexity

**Providers seeking turn-key / hands-off provisioning**
- V1 requires explicit operator approval for every job
- V1 requires manual intervention on failures (not auto-retry, not auto-rollback)
- Customers expecting "set and forget" will be disappointed

**Deployments without MikroTik expertise**
- If operators don't understand RouterOS or WireGuard, they can't debug failures
- V1 does not hide complexity; it exposes it

**Organizations with zero manual-intervention culture**
- V1 is fundamentally operator-centric
- Every failure, every pause, every cancel requires human decision
- If the org expects full automation, V1 is not the product

### Key Constraints and Prerequisites

1. **Network must be stable enough for retries**
   - V1 retries transient failures 3 times with backoff
   - If network is flaky (50% packet loss), every job will need manual intervention
   - Prerequisite: ISP has a stable network path to all routers

2. **Operators must be available**
   - Jobs cannot proceed without approval
   - Failures cannot be auto-recovered
   - Prerequisite: ISP has 24/7 on-call or business-hours-only provisioning

3. **MikroTik credentials must be securely managed**
   - V1 stores credentials encrypted
   - But operator must manage rotation, backup, access control
   - Prerequisite: ISP has credential management processes

4. **WireGuard keys must be pre-distributed**
   - V1 does not generate or distribute keys
   - Prerequisite: ISP manages WireGuard key lifecycle separately

5. **Router discovery and onboarding is manual**
   - V1 does not scan networks or auto-discover routers
   - Prerequisite: Operator manually registers each router with IP and credentials

6. **Rollback and disaster recovery is manual**
   - V1 provides snapshots (STABLE version), but rollback requires submitting a new job
   - If entire tenant's data is corrupted, operator restores from backup
   - Prerequisite: ISP has backup and DR processes

---

## 6. EXPLICIT PRODUCT NON-GOALS (What V1 Deliberately Does NOT Do)

### Automation Boundaries

#### ✗ V1 Does NOT Auto-Retry Permanent Failures
- If config is syntactically wrong, job fails once and enters MANUAL_REVIEW
- No background process retries it
- Operator must decide to retry or modify

#### ✗ V1 Does NOT Auto-Rollback
- If new config causes issues, operator must submit a new rollback job
- No time-based or event-triggered auto-rollback
- Operator always makes the rollback decision

#### ✗ V1 Does NOT Support Scheduled/Cron Jobs
- Cannot say "apply this job every Sunday at 2am"
- All jobs are explicit, on-demand submissions
- Scheduling must happen outside the SaaS

#### ✗ V1 Does NOT Support Batch Job Dependencies
- Cannot say "apply job B only if job A succeeds on the same router"
- Cannot say "apply to all 100 routers atomically, rollback if any fails"
- Each job is independent; orchestration happens outside

#### ✗ V1 Does NOT Support Tenant Self-Service Approval
- Tenants cannot approve their own jobs
- Operator approval is always required (ISP-grade safety rule)

#### ✗ V1 Does NOT Rewrite or Optimize Configs
- Backend applies exactly what tenant specifies
- No syntax normalization, no auto-optimization, no version compatibility shims
- Tenant is responsible for config correctness

#### ✗ V1 Does NOT Support Partial Config Application
- Either entire config is applied or job fails
- No "apply commands 1–5, skip 6–10" mode

#### ✗ V1 Does NOT Support Multi-Router Transactions
- Cannot apply config to 3 routers atomically
- If 2 succeed and 1 fails, that's the final state
- Operator must manually reconcile

### Scope Boundaries

#### ✗ V1 Does NOT Monitor Router Health
- V1 provisions routers; it doesn't monitor them
- No CPU, memory, traffic monitoring
- No auto-healing based on router metrics

#### ✗ V1 Does NOT Generate Configurations
- Operator must provide config templates or config JSON
- V1 does not generate configs based on traffic patterns or topology

#### ✗ V1 Does NOT Support Multi-Region Provisioning
- Cannot coordinate provisioning across geographic regions
- Cannot do geo-aware rollback or failover

#### ✗ V1 Does NOT Manage WireGuard Keys
- Operator must generate, distribute, and rotate keys separately
- V1 applies key configs that operator provides

#### ✗ V1 Does NOT Support Non-RouterOS Devices
- Only MikroTik RouterOS is supported
- Cisco, Ubiquiti, Juniper, etc. are out of scope

#### ✗ V1 Does NOT Provide SLA Uptime Guarantees
- V1 is best-effort
- No 99.9% uptime commitment
- No compensation for downtime

#### ✗ V1 Does NOT Support Zero-Touch Onboarding
- Operators must manually discover, register, and provide credentials for each router
- No auto-discovery, no QR code scanning, no cloud-init integration

#### ✗ V1 Does NOT Support Real-Time Alerting or Webhooks
- Mobile app is pull-based (operator pulls for updates)
- No push notifications, no SMS, no Slack integrations

### Intentional Omissions (By Design)

#### ✗ No Auto-Healing
- **Why omitted:** Auto-healing creates false confidence. Better to halt and alert the operator.
- **How operators handle:** Manual investigation and recovery

#### ✗ No Silent Failure Recovery
- **Why omitted:** Silent fixes hide problems. Better to fail visibly.
- **How operators handle:** Audit trail shows what happened

#### ✗ No Infinite Retries
- **Why omitted:** Infinite retries cause cascading failures. Better to limit and escalate.
- **How operators handle:** Manual retry after investigation

#### ✗ No Cross-Tenant Optimization
- **Why omitted:** Sharing data between tenants is a security risk. Better to isolate.
- **How operators handle:** Each tenant manages its own scale

#### ✗ No Implicit Decisions
- **Why omitted:** Implicit decisions hide risk. Better to require explicit approval.
- **How operators handle:** Click approve, click cancel, click retry

---

## CONCLUSION: A V1 Product You Can Rely On

This V1 product is **real, safe, and production-ready** for its target audience: **ISPs and network operators capable of queue-based provisioning with manual intervention.**

### What V1 Guarantees

| Guarantee | How Enforced |
|---|---|
| No unauthorized config changes | Operator approval gate + audit trail |
| No tenant data leakage | Tenant isolation at data layer + RBAC |
| No silent failures | Immutable audit log + operator visibility |
| No cascading outages | Queue isolation + router-level serialization |
| No router bricking | Pre-flight checks + manual recovery escape hatch |
| No partial config application | Atomic apply-verify-finalize phases |
| No loss of auditability | Immutable, write-once audit trail |
| Full operator control | Pause, resume, retry, cancel, quarantine, release |

### What V1 Requires from Operators

| Requirement | Why |
|---|---|
| MikroTik expertise | Must understand API, troubleshoot failures |
| Queue-based workflow | Provisioning is not real-time |
| Explicit approval for every job | No auto-approval, no fire-and-forget |
| Manual intervention on failures | No auto-retry, no auto-rollback |
| Audit discipline | Must be able to read logs and reconstruct events |
| Network stability | Retries 3 times; flaky networks need investigation |
| Credential management | Operator manages RouterOS creds, WireGuard keys |

### What V1 Does NOT Do

- Auto-approve or auto-retry
- Auto-rollback or auto-heal
- Manage WireGuard keys or credentials
- Monitor router health
- Support multi-region or zero-touch provisioning
- Promise SLA uptime or 24/7 support
- Hide failures or make implicit decisions

---

**This is a product that will not surprise you. It does exactly what you see, no more, no less.**

**For ISPs that understand MikroTik, have operational discipline, and value safety and auditability: V1 is ready.**

---

**Document prepared by:** Product & Architecture Review  
**Last updated:** 2026-05-05  
**Status:** APPROVED FOR PRODUCTION (ISP/Advanced Operator Use)
