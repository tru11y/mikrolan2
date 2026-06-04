# MikroTik Provisioning SaaS — Backend Construction Blueprint

## 1. BACKEND RESPONSIBILITY MAP

### The Backend OWNS and MUST guarantee:

**Job and Execution State**
- Authoritative record of every job submitted, scheduled, executed, and terminal state
- Job lifecycle: SUBMITTED → QUEUED → ASSIGNED → EXECUTING → TERMINAL (SUCCESS/FAILED/ROLLED_BACK/ABORTED)
- Every transition is recorded with timestamp, actor, and reason
- No job may exit EXECUTING state without explicit human approval of the outcome

**Router State Isolation**
- Router configuration is versioned: Current (active), Last Stable (rollback point), Proposed (pending approval)
- No configuration change may be applied until explicitly approved by an operator
- No two jobs may execute against the same router concurrently
- Router is the unit of serialization—all jobs targeting a router are strictly ordered

**Tenant Isolation**
- Tenant A's jobs, configuration snapshots, and audit records are cryptographically separated from Tenant B
- Tenant A may not read, modify, or reference Tenant B's routers, jobs, or history
- Resource quotas (queued jobs, active executions) are enforced per tenant
- Failed jobs in Tenant A do not cause job requeue or state corruption in Tenant B

**Immutable Audit Trail**
- Every job, approval, rejection, execution, and state change is logged in append-only storage
- Audit records include: who, what, when, why, router state before/after, and operator decision
- Audit logs are never modified, deleted, or archived—retained for compliance
- Operators and auditors can reconstruct exact sequence of events for any router

**Idempotency Contract**
- The backend guarantees that replaying any APPROVED job (same config, same router, same sequence) produces identical results
- A job may be safely retried after transient failure without creating duplicate or conflicting state
- Idempotency is enforced at the **job command level**, not the individual MikroTik API call level

**Failure Containment**
- A failed job on Router X does not block or affect any job on Router Y
- A network timeout during job execution does not put the router in an indeterminate state
- A burst of failed jobs does not trigger cascading retries or lock routers

### The Backend EXPLICITLY REFUSES:

- **Automatic rollback of approved jobs** (manual review required)
- **Automatic retry of failed jobs** (must be resubmitted by tenant)
- **Partial job execution** (either complete or fail, no half-states)
- **Silent failures** (all failures surface in audit trail and operator dashboard)
- **Configuration apply without approval** (no "best effort" or "fire and forget")
- **Cross-tenant data access** (even in error paths)
- **Background housekeeping that modifies router state** (cron jobs, auto-healing, etc.)

---

## 2. INTERNAL DOMAIN MODEL

### Core Entities

#### Job
```
Job {
  id:                 UUID (globally unique, immutable)
  tenant_id:          UUID (immutable, identifies owner)
  router_id:          UUID (immutable, targets this router)
  
  command:            ConfigCommand (DNS, Firewall, Interface, etc.)
  config_payload:     Opaque blob (tenant's JSON/binary config)
  
  state:              enum { SUBMITTED, QUEUED, ASSIGNED, EXECUTING, SUCCESS, FAILED, ROLLED_BACK, ABORTED }
  state_history:      [(timestamp, old_state, new_state, actor, reason)]
  
  queue_position:     Integer (order in router's queue, immutable after QUEUED)
  assigned_worker:    WorkerID or NULL (NULL until ASSIGNED)
  
  execution_started:  Timestamp or NULL
  execution_ended:    Timestamp or NULL
  execution_result:   {status, response_log, error_message} or NULL
  
  created_at:         Timestamp (when tenant submitted)
  approved_at:        Timestamp or NULL (when operator approved)
  approved_by:        OperatorID or NULL
  
  idempotency_key:    String (hash of: router_id + command + config_payload)
  
  metadata:           {priority, tags, tenant_context}
}
```

**Ownership rules:**
- Every job belongs to exactly one tenant
- A job cannot be read, modified, or queried without tenant_id verification
- Job state transitions are single-threaded per router (enforced by queue)

#### Router
```
Router {
  id:                 UUID (globally unique, immutable)
  tenant_id:          UUID (immutable)
  
  ip_address:         IP (mutable by operator, immutable for a job execution)
  access_credentials: Encrypted blob (SSH key, login, etc.)
  
  state:              enum { ONLINE, OFFLINE, EXECUTING, LOCKED, UNREACHABLE }
  last_heartbeat:     Timestamp
  
  config_versions: [
    {
      version_id:       UUID
      timestamp:        Timestamp
      source_job_id:    JobID or NULL (which job applied this)
      state:            enum { ACTIVE, STABLE, PROPOSED, REVERTED }
      snapshot:         Opaque (MikroTik config dump)
      applied_by:       OperatorID or NULL
      reverted_by:      OperatorID or NULL
    }
  ]
  
  job_queue:          [JobID] (ordered, FIFO within router)
  
  created_at:         Timestamp
  last_modified_by:   OperatorID
  
  metadata:           {location, model, firmware_version, ...}
}
```

**Ownership rules:**
- Every router belongs to exactly one tenant
- Router config is versioned; ACTIVE is production, STABLE is rollback point
- Job queue is serialized—only one job may be EXECUTING at a time

#### Execution Attempt
```
ExecutionAttempt {
  id:                 UUID
  job_id:             JobID
  worker_id:          WorkerID
  
  attempt_number:     Integer (1st, 2nd, 3rd, etc.)
  started_at:         Timestamp
  ended_at:           Timestamp or NULL (if still running)
  
  phase:              enum { 
    PRE_FLIGHT,       // verify config, test syntax
    CONNECT,          // SSH to router
    BACKUP,           // snapshot current config
    APPLY,            // apply config
    VERIFY,           // confirm result matches expected
    FINALIZE          // commit
  }
  
  phase_log:          {phase: [log_lines]}
  
  result:             enum { SUCCESS, TRANSIENT_FAILURE, PERMANENT_FAILURE, TIMEOUT, INTERRUPTED }
  error:              String (human-readable, no secrets)
  
  recovery_action:    enum { RETRY, MANUAL_REVIEW, ABORT, NONE }
  
  metadata:           {network_latency, router_load, ...}
}
```

**Ownership rules:**
- Execution attempts are transient (not immutable)
- Only the currently assigned worker may write to its own attempt
- Past attempts are read-only audit records

#### AuditEvent
```
AuditEvent {
  id:                 UUID
  timestamp:          Timestamp (server time, immutable)
  
  event_type:         enum { JOB_CREATED, JOB_QUEUED, JOB_APPROVED, JOB_EXECUTED, JOB_FAILED, CONFIG_REVERTED, ... }
  
  tenant_id:          UUID (which tenant this event concerns)
  router_id:          UUID or NULL (which router)
  job_id:             JobID or NULL (which job)
  
  actor:              OperatorID or "system"
  actor_type:         enum { HUMAN_OPERATOR, SYSTEM_PROCESS, TENANT_API }
  
  before_state:       JSON snapshot (previous state)
  after_state:        JSON snapshot (new state)
  
  decision:           String (why operator approved/rejected)
  
  metadata:           {ip_address, user_agent, ...}
}
```

**Ownership rules:**
- Audit events are write-once, never modified
- All audit events are queryable only by tenant (RBAC enforced)
- Audit events include full state snapshots (before/after) for compliance reconstruction

---

## 3. BACKEND EXECUTION FLOWS

### Flow 1: Job Submission

**Entry point:** Tenant calls backend with config command

```
STEP 1: Validate Submission
  ├─ Verify tenant is active (not suspended)
  ├─ Verify router_id belongs to this tenant
  ├─ Verify config_payload conforms to schema for this command
  ├─ Check queue depth: if > max_queued_jobs for tenant, reject
  └─ Generate idempotency_key = hash(router_id, command, config_payload)

STEP 2: Deduplication Check
  ├─ Query: is there an existing job with same idempotency_key in state QUEUED or EXECUTING?
  │   └─ If YES (and not stale): return existing job ID (idempotent resubmission)
  │   └─ If YES (and stale): create NEW job, mark old as superseded
  │   └─ If NO: continue
  └─ Record: JOB_CREATED audit event

STEP 3: Create Job Entity
  ├─ State = SUBMITTED
  ├─ Assign UUID
  ├─ Persist to authoritative store (transactional)
  └─ Return job ID to tenant immediately

STEP 4: Emit to Operator Queue
  ├─ Push (job_id, router_id, command_summary) to operator review dashboard
  ├─ Set TTL: operator must review within SLA (e.g., 30 min)
  └─ Return: {job_id, status: "awaiting_approval", eta_review: timestamp}

OUTCOME: Job exists, state=SUBMITTED, awaiting human approval
```

### Flow 2: Operator Approval (Critical Gate)

**Entry point:** Operator reviews job on dashboard and clicks APPROVE or REJECT

```
CASE A: Operator APPROVES job

STEP 1: Pre-approval Validation
  ├─ Verify operator has permission for this router
  ├─ Verify job still in SUBMITTED state
  ├─ Verify router is still ONLINE (not LOCKED or UNREACHABLE)
  └─ Verify no newer job has been approved for this router since submission

STEP 2: Atomic Approval
  ├─ Update job state: SUBMITTED → QUEUED
  ├─ Set approved_at = now(), approved_by = operator_id
  ├─ Compute queue_position = length(router.job_queue) + 1
  ├─ Append job_id to router.job_queue
  ├─ Persist atomically (both job and router updates succeed or both fail)
  └─ Record: JOB_APPROVED audit event with operator decision/notes

STEP 3: Signal Scheduler
  ├─ Emit router_id to scheduler: "router has new job in queue, check it"
  └─ Do NOT immediately execute

OUTCOME: Job state=QUEUED, in router's queue, ready for scheduler

---

CASE B: Operator REJECTS job

STEP 1: Atomic Rejection
  ├─ Update job state: SUBMITTED → ABORTED
  ├─ Record rejection reason from operator
  ├─ Record: JOB_REJECTED audit event
  └─ Do NOT add to queue

STEP 2: Notify Tenant
  ├─ Emit event: job rejected by operator (reason visible to tenant)
  └─ Tenant may resubmit modified job

OUTCOME: Job state=ABORTED, no execution possible
```

### Flow 3: Scheduling (Backend Deterministic Placement)

**Triggered by:** Router has queued jobs, or worker becomes available

```
STEP 1: Scanner (runs continuously or event-driven)
  ├─ Query: all routers with state QUEUED (excluding routers currently EXECUTING)
  └─ For each router: check head of job queue

STEP 2: Eligibility Check
  ├─ Is router ONLINE?
  │   └─ If OFFLINE: wait (retry in SLA)
  │   └─ If LOCKED: alert operator, do NOT schedule
  │   └─ If EXECUTING: wait for previous job to finish
  ├─ Can we acquire lock on this router?
  │   └─ Use distributed lock with TTL = max_execution_time + 30s
  ├─ Is there a worker available?
  │   └─ Query: workers in state IDLE
  │   └─ Prefer: worker with lowest recent latency to this router
  └─ Has execution SLA been exceeded?
      └─ If yes (job queued for >8 hours), escalate to operator

STEP 3: Atomic Assignment
  ├─ Update job: state QUEUED → ASSIGNED
  ├─ Set job.assigned_worker = worker_id
  ├─ Append job to worker's work queue
  ├─ Record: JOB_ASSIGNED audit event
  ├─ Persist all updates atomically
  └─ Return: SUCCESS or BACKOFF

STEP 4: Signal Worker
  ├─ Wake worker (message queue or pull): "pick up job {job_id}"
  └─ Worker acknowledges receipt (if ACK not received in 10s, mark job UNASSIGNED)

OUTCOME: Job state=ASSIGNED, worker is pulling execution
```

### Flow 4: Worker Execution

**Entry point:** Worker dequeues assigned job

```
STEP 0: Worker Lock Acquisition
  ├─ Worker attempts to acquire lock on job_id
  ├─ If lock exists (held by another worker): backoff, retry in 5s
  └─ If lock acquired: proceed (lock TTL = max_execution_time + 1 min)

STEP 1: Pre-flight Checks (30s timeout)
  ├─ Load job config
  ├─ Load router credentials
  ├─ Validate config syntax (static checks, no router contact yet)
  ├─ Verify router IP hasn't changed since job approval
  └─ If any check fails: mark job FAILED, route to manual review (do NOT retry)

STEP 2: Connection Phase (60s timeout)
  ├─ SSH to router IP with credentials
  ├─ Verify firmware version matches expected range
  ├─ Verify router responds to basic query (e.g., /ip address print)
  └─ If connection fails (transient): record error, trigger retry logic
  └─ If connection fails (permanent, e.g., wrong IP): mark FAILED, escalate

STEP 3: Backup Phase (90s timeout)
  ├─ Snapshot current running config from router
  ├─ Compare against: router.config_versions[ACTIVE]
  │   └─ If MISMATCH: log warning, record discrepancy in audit, continue anyway
  └─ Store snapshot as: router.config_versions[PROPOSED] (not ACTIVE yet)

STEP 4: Apply Phase (variable timeout, min 60s)
  ├─ Send config commands to router
  ├─ Stream responses into execution log
  ├─ If partial send (network interruption): 
  │   ├─ Stop sending
  │   ├─ Read router state to determine what was applied
  │   ├─ Mark job FAILED (partial apply is unacceptable)
  │   └─ Route to manual review
  └─ Continue until all commands sent or error encountered

STEP 5: Verification Phase (60s timeout)
  ├─ Read back config from router
  ├─ Compare against expected config (command + desired state)
  ├─ Verify no unintended side effects
  └─ If mismatch: log discrepancy, mark job FAILED, escalate (do NOT auto-correct)

STEP 6: Finalization (atomic)
  ├─ Update job: state EXECUTING → SUCCESS
  ├─ Set execution_ended = now()
  ├─ Save execution log to immutable storage
  ├─ Update router.config_versions[ACTIVE] = PROPOSED snapshot
  ├─ Move router.config_versions[ACTIVE] → STABLE (old STABLE is archived)
  ├─ Update router.last_modified_by = operator_id (from job approval)
  ├─ Release router lock
  ├─ Dequeue job from router.job_queue
  ├─ Record: JOB_EXECUTED audit event with full log
  └─ Signal scheduler: "check if this router has more queued jobs"

EXCEPTION: Transient Failure (timeout, network blip, MikroTik error)
  ├─ Stop execution immediately
  ├─ Update job: state EXECUTING → FAILED
  ├─ Set recovery_action = RETRY
  ├─ Release router lock
  ├─ Record: JOB_FAILED audit event (transient, eligible for retry)
  ├─ Push job back to end of router.job_queue
  ├─ Increment attempt_number
  ├─ Return to step 0 (max 3 total attempts)

EXCEPTION: Permanent Failure (bad config, unsupported feature, router rejects)
  ├─ Stop execution immediately
  ├─ Update job: state EXECUTING → FAILED
  ├─ Set recovery_action = MANUAL_REVIEW (no automatic retry)
  ├─ Release router lock
  ├─ Remove job from router.job_queue
  ├─ Record: JOB_FAILED audit event with full error, recovery_action
  ├─ Alert operator: "job {job_id} requires review"
  └─ Operator may reapprove (which requeues) or abort

OUTCOME: Job is either SUCCESS (config live) or FAILED (awaiting decision)
```

### Flow 5: Failure and Recovery

**Triggered when:** Job execution fails or operator must intervene

```
CASE A: Transient Failure (already covered in Flow 4)
  - Job is requeued automatically, up to 3 attempts
  - After 3 failures, escalate to MANUAL_REVIEW
  - Operator views execution logs and decides: retry, modify, or abort

CASE B: Permanent Failure (bad config, syntax error, etc.)
  - Job state = FAILED, recovery_action = MANUAL_REVIEW
  - Router is NOT LOCKED (lock released)
  - Operator reviews full execution log
  - Operator can:
    A) MODIFY job (upload new config) and resubmit (treated as new job)
    B) RETRY with same config (if logs suggest transient issue was misclassified)
    C) ABORT (remove job from queue)

CASE C: Router Becomes Unreachable During Execution
  - Worker detects: no SSH response, worker lock acquired but router not responding
  - Worker: stop execution, mark job FAILED, release lock, record UNREACHABLE
  - Router state = UNREACHABLE (operator must manually verify router is alive)
  - Job enters MANUAL_REVIEW
  - Operator can restore router to ONLINE only after verifying it's reachable
  - Operator resets job state and requeues if desired

CASE D: Operator Aborts Running Job
  - Operator clicks ABORT on a job in EXECUTING state
  - Backend: send signal to worker to stop execution
  - Worker: stop sending commands, close SSH, release lock
  - Update job: EXECUTING → ABORTED
  - Record: JOB_ABORTED audit event
  - Router config is left in whatever state it was (no automatic rollback)

CASE E: Config Mismatch Detected (actual vs approved)
  - During backup or verification, worker reads config different from approved
  - Worker: record discrepancy in execution log, mark job FAILED
  - Operator: reviews log, sees actual vs expected mismatch
  - Operator must manually review router configuration
  - Operator can: retry job (override), manual fix on router, or archive job
  - No automatic correction or rollback is permitted

```

---

## 4. SAFETY GUARANTEES

### No Router Lockout

**Guarantee:** A failed job execution does NOT prevent subsequent job submission or approval.

**Implementation:**
1. Job execution failure does NOT set router to LOCKED state
2. Router is only set LOCKED by operator (explicit action)
3. Job failure at any phase (apply, verify, finalize) releases the router lock immediately
4. Operator may always submit a new job to recover (e.g., "restore factory config")
5. If router is truly inaccessible (UNREACHABLE), operator must manually restore connectivity

**What backend prevents:**
- Cannot execute two jobs on same router concurrently
- Cannot apply config without prior backup
- Cannot finalize without verification
- Cannot proceed with apply if pre-flight fails

### Idempotency Guarantee

**Guarantee:** The same APPROVED job may be executed multiple times against the same router with identical results.

**Implementation:**
1. Idempotency is defined at the **command level**, not individual API calls
   - Example: "Enable DHCP on interface ether1" is idempotent (run twice = same state)
   - Counterexample: "Create firewall rule #100" is NOT idempotent (second run fails if rule exists)
2. The backend does NOT enforce command-level idempotency (tenant is responsible)
3. The backend GUARANTEES:
   - Same input config + same router + same command type = same result (or predictable error)
   - No silent partial application
   - No state corruption if job is retried
4. Worker validates config syntax before sending (catches bad commands early)
5. Worker verifies result after apply (detects partial failures)

### Retry Control and Backoff

**Guarantee:** Failed jobs do NOT cascade into cascading failures or retry storms.

**Implementation:**
1. Only transient failures trigger automatic retry
   - Transient: network timeout, SSH connection refused, MikroTik temporary overload
   - Permanent: syntax error, unsupported feature, wrong credentials
2. Automatic retry limit: 3 attempts per job
3. Backoff strategy: exponential, with jitter
   - 1st attempt: immediately
   - 2nd attempt: after 30s + random(0-10s)
   - 3rd attempt: after 2min + random(0-30s)
   - 4th+ attempt: escalate to MANUAL_REVIEW (no more automatic retry)
4. Worker detects permanent failures and sets recovery_action = MANUAL_REVIEW (stops retry)
5. Operator decides whether to retry, modify, or abort

### Tenant Isolation Guarantee

**Guarantee:** Tenant A cannot read, modify, or observe Tenant B's data or jobs.

**Implementation:**
1. Every query includes tenant_id filter (enforced at data access layer)
2. Jobs are tagged with tenant_id at creation
3. Routers are tagged with tenant_id at creation
4. Audit events are tagged with tenant_id
5. Worker processes are single-tenant per job execution (no cross-tenant leakage)
6. Error messages never include tenant-identifying details (names, IPs, credentials)
7. All storage is logically partitioned by tenant_id

### No Silent Failures

**Guarantee:** Every failure is visible to operator and audit trail.

**Implementation:**
1. Every state transition is logged
2. Every execution phase has a timeout; timeout = explicit failure
3. Every error has a human-readable reason
4. Every failure blocks further execution until operator decides
5. No background cleanup or housekeeping jobs that hide errors
6. Operator dashboard shows all FAILED and MANUAL_REVIEW jobs prominently

---

## 5. OPERATOR INTERACTION POINTS

### Required Human Approvals

| Decision Point | When | Effect |
|---|---|---|
| **Job Approval** | After tenant submits job | Move job to QUEUED, enable scheduling |
| **Rejection** | After tenant submits job | Abort job, notify tenant to resubmit |
| **Manual Review of Failed Job** | After job fails (permanent) | Decide: retry, modify, or abort |
| **Router Status Change** | Operator marks router LOCKED/ONLINE | Block or enable job execution |
| **Configuration Rollback** | Operator issues rollback command | Restore to last STABLE version (requires approval) |
| **Abort Running Job** | Emergency, operator decision | Stop execution immediately |

### Operator Queries and Visibility

| Information | Operator Must See | Update Frequency |
|---|---|---|
| **Job Queue per Router** | All queued jobs, approval status, age | Real-time |
| **Execution Status** | Current job executing, phase, elapsed time | Real-time |
| **Failed Jobs** | All failed jobs, error reason, recovery action | Real-time |
| **Audit Trail** | All state changes, approvals, rejections, who did what | Real-time, immutable |
| **Router Health** | ONLINE/OFFLINE/EXECUTING/LOCKED/UNREACHABLE | Per heartbeat (30s) |
| **Execution Logs** | Full command output, router responses, warnings | After job completes |

### Operator Cannot Do

- Modify queued job config (can only approve, reject, or abort)
- Apply configuration without explicit approval (no "fire and forget")
- Bypass verification (cannot mark unverified job as SUCCESS)
- Rollback without audit record
- Access another operator's credentials or decisions
- Silence or hide failures

---

## 6. EXPLICIT BACKEND NON-GOALS (V1)

### Version 1 deliberately does NOT support:

1. **Auto-healing or self-correcting jobs**
   - If job fails, operator decides next step
   - No background process that auto-rolls-back or corrects

2. **Batch job orchestration**
   - Cannot submit "apply config to 100 routers at once"
   - Each router is a separate submission and approval
   - Use case: tenant may write a loop (outside SaaS) to submit 100 jobs

3. **Config versioning and diff tools**
   - Backend stores config snapshots
   - No UI for "compare version A vs version B"
   - Operator compares manually or uses external tools

4. **Scheduled jobs (cron-based)**
   - Cannot schedule "apply this every Sunday at 2am"
   - All jobs are explicit submission by tenant

5. **Rollback automation**
   - Operator may restore to STABLE version manually
   - Requires explicit approval (no automatic rollback)
   - No time-based automatic rollback

6. **Job dependencies**
   - Cannot say "apply job B only after job A succeeds"
   - Each job is independent
   - Tenant may implement orchestration outside SaaS

7. **Multi-router transactions**
   - Cannot apply config to 3 routers atomically
   - If 2 succeed and 1 fails, that's the result
   - Operator must manually reconcile

8. **Tenant self-service approval**
   - Tenant cannot approve own jobs
   - Operator approval is always required (ISP-grade constraint)

9. **Partial config application**
   - Either apply entire config or fail
   - No "apply commands 1-5, skip 6-10" partial mode

10. **Command transformations or optimizations**
    - Backend does NOT rewrite, optimize, or normalize user config
    - Backend applies exactly what tenant specified
    - Tenant is responsible for correct syntax

11. **MikroTik version compatibility shims**
    - Backend does NOT auto-detect firmware and adjust syntax
    - Tenant specifies expected firmware version
    - If router firmware doesn't match, job fails

12. **Network failover or redundancy**
    - If router is dual-homed, backend does NOT handle it
    - Each router IP is static for a job
    - Tenant manages network resilience

---

## 7. EXECUTION GUARANTEES SUMMARY

### State Transitions are Atomic

Every state change (job approved, job assigned, job executed) is atomic at the data store level. If a write fails, the state does not change. No partial updates.

### Workers are Stateless

Workers are ephemeral processes. If a worker crashes mid-execution:
1. Job remains EXECUTING (lock held until TTL expires)
2. After TTL, another worker can claim the job (retry attempt)
3. No data loss on worker crash (everything is persisted in backend)

### Router Lock is Enforced

During job execution, router holds a distributed lock (TTL = max execution time + grace period). No other job may be assigned while lock is held. If lock holder crashes, lock expires and job is eligible for retry.

### No Cascading Failures

Failure in one job, tenant, or router does NOT affect others:
- Failed job on Router A: Router B jobs continue normally
- Failed job from Tenant X: Tenant Y can submit and execute jobs
- Failed worker: other workers continue, job is requeued

### Timeouts are Explicit

Every operation has a timeout. Timeout = failure, not a hang. Worker signals job failure immediately when timeout expires.

---

## APPENDIX: Key Terms

| Term | Definition |
|---|---|
| **SUBMITTED** | Job is created, awaiting operator approval |
| **QUEUED** | Job is approved, waiting to be scheduled |
| **ASSIGNED** | Job is assigned to a worker, worker is starting execution |
| **EXECUTING** | Worker is actively running commands on router |
| **SUCCESS** | Job completed, config is ACTIVE |
| **FAILED** | Job did not complete, recovery_action set |
| **ABORTED** | Job rejected or manually stopped by operator |
| **ROLLED_BACK** | Config reverted to previous stable version |
| **Idempotency Key** | Hash of router_id + command + config payload (deduplication) |
| **Router Lock** | Distributed lock preventing concurrent execution |
| **STABLE Version** | Last known-good configuration (rollback point) |
| **ACTIVE Version** | Current running configuration |
| **PROPOSED Version** | Configuration snapshot from current job execution |
| **Manual Review** | Operator intervention required (not auto-retry) |
| **Transient Failure** | Temporary error, eligible for retry (timeout, network) |
| **Permanent Failure** | Cannot recover, requires operator decision (bad config) |

---

**This blueprint defines WHAT the backend must guarantee, not HOW to implement it. Implementation teams may choose datastore, queue system, worker orchestration, and API framework—but behavior must match these guarantees.**
