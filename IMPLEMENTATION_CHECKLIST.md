# MikroLan V1 Backend Implementation Checklist

**For backend engineers building against the MikroLan V1 design.**

---

## CRITICAL INVARIANTS (Non-Negotiable)

These must be enforced in code or the system breaks. No exceptions, no workarounds.

### 1. ROUTER ISOLATION
- [ ] Every database query filters by `tenant_id` at query execution time
- [ ] Tenant A cannot read, modify, or observe Tenant B's routers, jobs, or audit logs
- [ ] Error messages never leak tenant names, IPs, or credentials across tenants
- [ ] Cross-tenant data access is impossible even if a row's tenant_id is corrupted
  - **Test:** Try to query `GET /routers?tenant_id=OTHER` with your credentials → must return 403

### 2. NO CONCURRENT JOB EXECUTION ON SAME ROUTER
- [ ] Only one job may be in `EXECUTING` state per router at any moment
- [ ] Job execution acquires a distributed lock (TTL = max_execution_time + 30s)
- [ ] A second job attempting same router while first is locked must wait or return 409 Conflict
- [ ] Lock expires automatically; no permanent locks are possible
  - **Test:** Submit two apply jobs for same router simultaneously → second must queue, not execute

### 3. NO CONFIGURATION APPLY WITHOUT EXPLICIT APPROVAL
- [ ] Config changes start in `SUBMITTED` state (awaiting operator)
- [ ] Backend CANNOT transition job to `QUEUED` without human approval
- [ ] No background process, cron job, or automation may bypass approval gate
- [ ] Operator approval must be explicit (click button, not implicit from timeout)
  - **Test:** Submit config, check job state is `SUBMITTED` until operator approves

### 4. IMMUTABLE AUDIT TRAIL
- [ ] Every job transition (SUBMITTED → QUEUED → ASSIGNED → EXECUTING → SUCCESS/FAILED) is logged
- [ ] Audit events are write-once, never updated or deleted
- [ ] Audit record includes: actor (who), action (what), before_state, after_state, timestamp, reason
- [ ] All mutations produce an audit event *before* state change commits
  - **Test:** Corrupt an audit log entry → system detects tampering on next read

### 5. STATE MACHINE IS STRICTLY ENFORCED
- [ ] Jobs follow only valid state transitions:
  ```
  SUBMITTED → QUEUED (operator approval)
  QUEUED → ASSIGNED (scheduler)
  ASSIGNED → EXECUTING (worker starts)
  EXECUTING → SUCCESS (verification passes)
  EXECUTING → FAILED (error, not auto-rolled back)
  QUEUED → ABORTED (operator rejection)
  EXECUTING → ABORTED (operator stops mid-run)
  ```
- [ ] Invalid transitions are rejected at database level (not just application logic)
- [ ] No job may jump states (e.g., QUEUED → SUCCESS without EXECUTING)
  - **Test:** Try `UPDATE jobs SET state='SUCCESS' WHERE state='SUBMITTED'` → constraint violation

### 6. VERIFICATION BEFORE FINALIZATION
- [ ] After configuration is applied to router, verify actual state matches intended
- [ ] Verification failure blocks finalization (config is NOT marked applied)
- [ ] Mismatch is logged and escalated to manual review (no auto-correct)
  - **Test:** Apply config, then manually change router config via console → next verify job fails

### 7. ROUTER MUST NEVER BE UNREACHABLE AFTER JOB FAILURE
- [ ] Failed job does NOT leave router in LOCKED state
- [ ] Router remains ONLINE or transitions to OFFLINE, never LOCKED by automation
- [ ] Only operator can set LOCKED state (explicit action)
- [ ] Operator can always submit recovery job to LOCKED router (no dead-end state)
  - **Test:** Kill a job mid-execution → router is still accessible for new jobs

### 8. NO PARTIAL JOB EXECUTION
- [ ] Either entire config is applied or none is
- [ ] No "apply commands 1-5, skip 6-10 because of error" behavior
- [ ] If any command fails mid-apply, stop immediately, mark job FAILED
- [ ] Partial state on router is treated as permanent failure (manual review required)
  - **Test:** Apply 10 firewall rules, fail on rule 7 → all 10 are either applied or none

### 9. EXPLICIT BACKOFF AND RETRY LIMITS
- [ ] Retry logic has explicit limits: max 3 attempts per job
- [ ] Only transient failures trigger auto-retry (network timeout, connection refused)
- [ ] Permanent failures (bad config, syntax error) do NOT auto-retry
- [ ] Backoff is exponential with jitter: 30s, 2min, 5min (+ randomness)
- [ ] After max attempts, job escalates to MANUAL_REVIEW (no more automatic retry)
  - **Test:** Network flake → job retries; syntax error → job stops at attempt 1

### 10. OPERATOR CONTROL OVER AUTOMATION
- [ ] Operator must be able to PAUSE, HALT, or ROLLBACK any running job
- [ ] No automation may run that operator cannot immediately stop
- [ ] Operator can always view full execution log (no hidden failures)
- [ ] Rollback is manual: operator selects previous config version and applies (not automatic)
  - **Test:** Start apply job, operator clicks abort → job stops within 10 seconds

---

## TRANSACTION BOUNDARIES (Atomic Operations)

These boundaries MUST be atomic. Partial commits are unacceptable.

### Job Approval (Approval Gate)
```
ATOMIC TRANSACTION:
1. Verify operator has permission
2. Verify job is in SUBMITTED state
3. Verify router is not LOCKED
4. Create audit event (JOB_APPROVED)
5. Update job state: SUBMITTED → QUEUED
6. Append job_id to router.job_queue
7. COMMIT all 4 changes together
```
**If any step fails, roll back all changes. Job remains in SUBMITTED state.**

### Job Scheduling (Scheduler Claims Work)
```
ATOMIC TRANSACTION:
1. Check router is ONLINE
2. Verify no job currently EXECUTING on router
3. Acquire distributed lock on router (with TTL)
4. Update job state: QUEUED → ASSIGNED
5. Set assigned_worker = worker_id
6. Create audit event (JOB_ASSIGNED)
7. COMMIT all changes
```
**Failure → job remains QUEUED, lock not acquired. Retry in next scheduler tick.**

### Job Execution Success (Finalization)
```
ATOMIC TRANSACTION:
1. Verify execution phase completed successfully
2. Verify verification phase confirmed convergence
3. Create audit event (JOB_EXECUTED)
4. Update job state: EXECUTING → SUCCESS
5. Update router.config_versions[ACTIVE] = new snapshot
6. Increment router.config_version counter
7. Release router lock
8. COMMIT all changes
```
**Failure → job remains EXECUTING, lock held. Worker crash → lock expires, job requeued.**

### Job Execution Failure (Error Handling)
```
ATOMIC TRANSACTION (on transient failure):
1. Log error to execution_attempt
2. Create audit event (JOB_FAILED_TRANSIENT)
3. Update job state: EXECUTING → FAILED
4. Set recovery_action = RETRY
5. Increment attempt_number
6. Re-append job to router.job_queue (end of queue)
7. Release router lock
8. COMMIT all changes
```
**Then exit worker. Scheduler will pick job up in next tick.**

```
ATOMIC TRANSACTION (on permanent failure):
1. Log error to execution_attempt
2. Create audit event (JOB_FAILED_PERMANENT)
3. Update job state: EXECUTING → FAILED
4. Set recovery_action = MANUAL_REVIEW
5. Remove job from router.job_queue (do NOT requeue)
6. Release router lock
7. Alert operator dashboard
8. COMMIT all changes
```
**Job now awaits operator decision (retry, modify, or abort).**

---

## CONCURRENCY RULES (Enforce These at Database Level)

Concurrency bugs hide in production. Enforce at schema, not just application.

### 1. ROUTER LOCK ENFORCEMENT
- [ ] Use database-backed distributed lock (not in-process mutex)
- [ ] Lock table: `router_locks (router_id, worker_id, acquired_at, expires_at)`
- [ ] Acquire lock: `INSERT INTO router_locks (...) WHERE NOT EXISTS (SELECT 1 FROM router_locks WHERE router_id=X AND expires_at > NOW())`
- [ ] Check lock: `SELECT * FROM router_locks WHERE router_id=X AND expires_at > NOW()`
- [ ] Release lock: `DELETE FROM router_locks WHERE router_id=X AND worker_id=Y`
- [ ] **Never hold a lock longer than max_execution_time + grace_period (default 45 min)**
- [ ] Expired locks are automatically available (TTL expires naturally)

### 2. JOB STATE TRANSITIONS ARE SINGLE-THREADED PER ROUTER
- [ ] Add `CHECK (NOT EXISTS (SELECT 1 FROM jobs WHERE router_id=X AND state='EXECUTING' AND id != current_job_id))` constraint
  - **Or:** enforce in application with SELECT ... FOR UPDATE row lock
- [ ] Before updating job state to EXECUTING, verify no other job on router is EXECUTING
- [ ] Queue state transitions in database (FIFO), not memory

### 3. AUDIT EVENTS ARE IMMUTABLE
- [ ] Audit table has no UPDATE or DELETE permissions (only INSERT)
- [ ] Schema constraint: `ALTER TABLE audit_events DISABLE UPDATE`
- [ ] Backup and retention policy: append-only storage (not truncatable)
- [ ] Include `created_at` with server-generated timestamp (not client-controlled)

### 4. IDEMPOTENCY KEY DEDUPLICATION
- [ ] Add unique constraint: `UNIQUE (tenant_id, idempotency_key)`
- [ ] Compute idempotency_key = SHA256(router_id + command_type + config_payload_hash)
- [ ] When submitting job: `INSERT ... ON CONFLICT (idempotency_key) DO UPDATE SET ...` (upsert)
- [ ] Same submission within 5 minutes returns existing job_id (not duplicate)
- [ ] After 5 minutes, new submission with same key creates new job

### 5. TENANT ISOLATION AT SCHEMA LEVEL
- [ ] Every table has `tenant_id` column (FK to tenants table)
- [ ] Row-level security policy: `CREATE POLICY rls_tenant ON table FOR ALL USING (tenant_id = current_tenant_id)`
- [ ] Add index on `(tenant_id, other_columns)` for all queries
- [ ] Application code: every SELECT/UPDATE/DELETE must include `WHERE tenant_id = ?`
- [ ] Database layer should reject any query missing tenant_id filter

### 6. NO SHARED MUTABLE STATE IN APPLICATION
- [ ] All state is in database, not in-process variables
- [ ] Workers are stateless; crash and restart are safe
- [ ] Configuration passed to worker as immutable snapshot (not reference to live object)
- [ ] Each task reads its router state fresh at start of each phase (no cached state)

---

## COMMON IMPLEMENTATION TRAPS

Trap yourself in these and you'll have production incidents.

### TRAP 1: Assuming Job Is Atomic Across Multiple Tables
**Bad:**
```python
job.state = "EXECUTING"
job.save()
router.status = "EXECUTING"
router.save()  # If this fails, job is in wrong state
```

**Good:**
```python
db.execute("""
  BEGIN TRANSACTION;
  UPDATE jobs SET state='EXECUTING' WHERE id=?;
  UPDATE routers SET status='EXECUTING' WHERE id=?;
  COMMIT;
""")
```

### TRAP 2: Checking State, Then Acting (Race Condition)
**Bad:**
```python
if job.state == "QUEUED":  # Check
    job.execute()           # Act (another worker may have claimed it)
```

**Good:**
```python
rows_updated = db.execute("""
  UPDATE jobs SET state='EXECUTING', assigned_worker=? 
  WHERE id=? AND state='QUEUED'
""")
if rows_updated == 0:
    # Another worker beat us to it
    return "Job already assigned"
```

### TRAP 3: Releasing Lock Before Finalizing State
**Bad:**
```python
router.lock.release()                    # Release lock
db.execute("UPDATE jobs SET state=SUCCESS")  # If this fails, job hangs
```

**Good:**
```python
db.execute("""
  UPDATE jobs SET state=SUCCESS WHERE id=?;
  DELETE FROM router_locks WHERE router_id=?;
  COMMIT;
""")
```

### TRAP 4: Logging After State Change (Lost Audit)
**Bad:**
```python
job.state = "SUCCESS"
job.save()
audit_log.add({"action": "JOB_EXECUTED", "job_id": job.id})
audit_log.save()  # If this fails, audit event is lost
```

**Good:**
```python
db.execute("""
  BEGIN TRANSACTION;
  INSERT INTO audit_events (...) VALUES (...);
  UPDATE jobs SET state=SUCCESS WHERE id=?;
  COMMIT;
""", (audit_event_data, job_id))
```

### TRAP 5: Assuming "Offline" Means Safe
**Bad:**
```python
if router.status == "OFFLINE":
    router.status = "EXECUTING"  # Dangerous; router may come online mid-apply
    apply_config(router)
```

**Good:**
```python
# Require lock + ONLINE check inside execution
if not acquire_lock(router.id):
    return "Router is locked"
if not ping_router(router.ip):
    return "Router offline"
apply_config(router)
```

### TRAP 6: Retrying Without Backoff
**Bad:**
```python
for attempt in range(3):
    try:
        apply_config(router)
    except NetworkError:
        continue  # Immediate retry = thundering herd
```

**Good:**
```python
for attempt in range(3):
    try:
        apply_config(router)
    except NetworkError:
        if attempt < 2:
            wait(exponential_backoff(attempt) + random(0, jitter))
        else:
            raise  # Max attempts exceeded
```

### TRAP 7: Partial Config Application
**Bad:**
```python
for rule in config.firewall_rules:
    try:
        router.add_firewall_rule(rule)
    except RouterError:
        continue  # Skip failed rule, apply rest
```

**Good:**
```python
try:
    for rule in config.firewall_rules:
        router.add_firewall_rule(rule)
except RouterError:
    # Stop immediately; router has partial state
    raise ConfigPartiallyApplied(f"Rule {rule.id} failed")
```

### TRAP 8: Silent Failure on Timeout
**Bad:**
```python
def apply_config(router, timeout=30):
    try:
        router.api_call("/config/apply", config)
        # If timeout expires, exception is caught silently
    except socket.timeout:
        pass  # Assuming success is risky
```

**Good:**
```python
def apply_config(router, timeout=30):
    try:
        router.api_call("/config/apply", config, timeout=timeout)
    except socket.timeout:
        # Unknown state on router; must verify before claiming success
        raise PermanentFailure("Timeout; router state unknown; requires manual review")
```

### TRAP 9: Operator Approval Bypass
**Bad:**
```python
# Background housekeeping that modifies router
if router.needs_optimization():
    apply_optimization(router)  # No operator approval!
```

**Good:**
```python
# NEVER auto-apply anything
# Even "obviously correct" optimizations require explicit approval
# Only submit job; operator must approve
```

### TRAP 10: Mixing Rollback Logic with Failure Handling
**Bad:**
```python
if job_failed:
    router.rollback_config()  # Auto-rollback on failure = dangerous
```

**Good:**
```python
if job_failed:
    # Log failure, alert operator
    # Operator decides: retry same config, apply different config, or manual fix
    # NO automatic rollback
```

---

## WHAT MUST BE TESTED EXHAUSTIVELY

Before production, these scenarios must pass. Not as unit tests; as integration tests with real database and network.

### TEST SUITE 1: Job Lifecycle
- [ ] **Job Approval Flow**
  - Submit job → verify state is SUBMITTED
  - Operator approves → state transitions to QUEUED
  - Verify approval is audit-logged
  - Operator rejects → state transitions to ABORTED, no execution occurs
  
- [ ] **Job Deduplication**
  - Submit config with idempotency_key=K
  - Submit identical config with same key within 5 min → returns same job_id
  - Submit identical config after 5 min → creates new job
  
- [ ] **Job Queueing & Scheduling**
  - Submit 10 jobs for same router → all QUEUED
  - Scheduler claims first job → state ASSIGNED
  - Scheduler does NOT claim second job until first is EXECUTING
  - After first completes, second job is claimed automatically

### TEST SUITE 2: Concurrency & Race Conditions
- [ ] **Router Lock Prevents Concurrent Execution**
  - Start apply job on Router A (lock acquired)
  - Try to start another job on Router A → must wait or return 409
  - First job completes (lock released)
  - Second job can now execute
  
- [ ] **Two Workers Claim Same Job**
  - Worker 1 and Worker 2 both try to claim job J simultaneously
  - Database transaction ensures only one succeeds
  - Losing worker gets "job already assigned" response
  
- [ ] **Tenant Isolation Under Concurrent Load**
  - Tenant A submits 50 jobs, Tenant B submits 50 jobs in parallel
  - Tenant A can only see its 50 jobs (not B's)
  - Audit logs are segregated by tenant
  - Even in error paths (e.g., job not found), no cross-tenant data leaks

### TEST SUITE 3: Failure Scenarios
- [ ] **Network Timeout During Apply**
  - Apply job loses SSH connection mid-apply
  - Job fails with "connection lost" (transient)
  - Verify router is not in LOCKED state (job can be retried)
  - Job is requeued, scheduler will retry
  
- [ ] **Router Becomes Unreachable During Execution**
  - Worker connects to router, starts applying
  - Router loses power (becomes unreachable)
  - Worker detects no response, marks job FAILED
  - Router state remains accessible (operator can recover)
  - Operator can restore router to ONLINE, then requeue job
  
- [ ] **Operator Aborts Running Job**
  - Apply job is in EXECUTING state
  - Operator clicks "ABORT JOB"
  - Worker stops sending commands within 10 sec
  - Lock is released, router is accessible
  - Router config is left in whatever state it was (no rollback)
  - Operator can submit recovery job if needed
  
- [ ] **Permanent Failure (Bad Config)**
  - Job attempts to apply invalid firewall rule
  - Worker detects syntax error, stops apply
  - Job transitions to FAILED with recovery_action=MANUAL_REVIEW
  - Job is NOT automatically retried
  - Operator reviews log, decides to fix config or abort

### TEST SUITE 4: Verification & Convergence
- [ ] **Successful Verification**
  - Apply WireGuard peer config
  - Verify phase reads router state, confirms peer was added
  - Job transitions to SUCCESS
  
- [ ] **Verification Mismatch (Drift)**
  - Apply config to add firewall rule
  - Verification reads router, rule is missing (somehow not applied)
  - Job transitions to FAILED, NOT to SUCCESS
  - Operator reviews mismatch, decides next step
  
- [ ] **Convergence Polling**
  - Apply config
  - Verify immediately (may be pending on router)
  - Verify waits 5 seconds, then retries
  - Eventually converges or times out (no infinite wait)

### TEST SUITE 5: Audit Trail
- [ ] **Immutability**
  - Submit job → audit event created
  - Try to DELETE or UPDATE audit event → permission denied
  - Try to INSERT backdated audit event → rejected
  
- [ ] **Completeness**
  - Submit job (audit event)
  - Approve job (audit event with operator_id, decision)
  - Assign job (audit event)
  - Execute job (audit event with before/after state)
  - Fail job (audit event with error)
  - Verify all 5 events exist in audit trail
  
- [ ] **Full State Snapshot**
  - Audit event includes before_state and after_state (JSON snapshots)
  - Can reconstruct router history from audit trail alone
  - No state information is lost (all details in audit events)

### TEST SUITE 6: Scaling & Performance
- [ ] **100 Routers, 10 Jobs Each (1000 jobs total)**
  - Submit 1000 jobs across 100 routers
  - Scheduler correctly distributes work (no starvation)
  - All jobs complete within SLA (e.g., 4 hours)
  - No deadlocks, no leaked locks
  
- [ ] **Per-Tenant Rate Limiting**
  - Tenant A limit=10, Tenant B limit=5
  - Both submit 100 jobs
  - A never has >10 executing; B never has >5
  - Fairness: both make progress (not one starves the other)
  
- [ ] **Lock Expiration**
  - Force a worker to hold a lock for max_execution_time + 1 hour
  - Lock expires naturally (TTL)
  - Job can be picked up by another worker
  - No deadlock

### TEST SUITE 7: Operator Workflows
- [ ] **Job Approval Dashboard**
  - Operator sees list of SUBMITTED jobs
  - Can view config diff (intended vs current)
  - Can approve, reject, or defer each job
  
- [ ] **Failed Job Review**
  - Job fails during execution
  - Operator sees full execution log (which command failed, why)
  - Can choose to retry, modify config + resubmit, or abort
  
- [ ] **Rollback Workflow**
  - Apply config V2
  - Operator wants to revert to V1
  - Operator selects V1, submits "rollback to V1"
  - V1 is applied as new job (full verification cycle)
  - If V1 re-apply fails, operator can try V0, V-1, etc.

### TEST SUITE 8: Data Consistency
- [ ] **No Orphaned Jobs**
  - Kill backend process mid-job execution
  - Restart backend
  - Job remains EXECUTING (lock held)
  - After lock TTL expires, job can be requeued or manually reviewed
  
- [ ] **Router State Matches Job State**
  - Every ACTIVE router config corresponds to successful job
  - Every FAILED job has no associated ACTIVE config
  - Query: `SELECT * FROM routers WHERE config_version > MAX(job.version WHERE job.state='SUCCESS')` → empty result
  
- [ ] **Tenant Data Segregation**
  - Tenant A queries its routers → only sees its routers
  - Tenant A queries Tenant B's router_id directly → 403 Forbidden
  - Audit trail queries never cross tenant boundaries

---

## IMPLEMENTATION CHECKLIST: BEFORE CODE REVIEW

**Mark as complete before submitting PR.**

### Database Schema
- [ ] All tables have `tenant_id` foreign key
- [ ] Indexes on `(tenant_id, other_key_columns)` for all queries
- [ ] Audit table is append-only (no UPDATE or DELETE permissions)
- [ ] Job and Router tables have state enum with valid transitions enforced
- [ ] Router lock table has TTL-based expiration

### Application Code
- [ ] Every SELECT/UPDATE/DELETE query includes `WHERE tenant_id = ?`
- [ ] State transitions are atomic (all changes in single transaction)
- [ ] Locks are acquired at database level (not in-process)
- [ ] Retry logic has explicit limits and exponential backoff
- [ ] Operator approval is required before job execution (no bypasses)
- [ ] Error handling differentiates transient vs permanent failures
- [ ] Verification phase confirms actual state matches intended
- [ ] No background jobs that modify router state without approval

### Testing
- [ ] All test suites (1-8 above) pass
- [ ] Concurrency tests pass with 50+ routers, 10+ concurrent jobs
- [ ] Audit trail is complete (no missing events)
- [ ] Tenant isolation verified (Tenant A cannot access Tenant B data)
- [ ] Operator workflows tested end-to-end

### Documentation
- [ ] API endpoints document required approvals
- [ ] Operations guide explains manual recovery procedures
- [ ] Runbook for each failure scenario (router offline, job stuck, etc.)

---

## Quick Reference: Common Code Patterns

### Pattern 1: Safe State Transition
```python
def transition_job_state(job_id, new_state, reason):
    rows_updated = db.execute("""
        UPDATE jobs 
        SET state = ?, state_updated_at = NOW()
        WHERE id = ? AND tenant_id = ?
    """, (new_state, job_id, current_tenant_id))
    
    if rows_updated == 0:
        raise JobNotFound("Job not in expected state")
    
    # Always audit after successful transition
    db.execute("""
        INSERT INTO audit_events 
        (job_id, tenant_id, action, reason, after_state)
        VALUES (?, ?, 'JOB_STATE_CHANGE', ?, ?)
    """, (job_id, current_tenant_id, reason, new_state))
```

### Pattern 2: Idempotent Configuration Apply
```python
def apply_config_idempotent(router_id, config):
    # Step 1: Check if config already exists
    existing = router_api.get_config()
    if existing == config:
        return "OK"  # Already applied
    
    # Step 2: Apply new config
    try:
        for command in config:
            router_api.execute(command)
    except RouterError as e:
        raise PermanentFailure(f"Config apply failed: {e}")
    
    # Step 3: Verify result
    applied = router_api.get_config()
    if applied != config:
        raise VerificationFailed(f"Config mismatch after apply")
    
    return "OK"
```

### Pattern 3: Lock-Safe Job Execution
```python
def execute_job(job_id, router_id):
    # Acquire lock before any state change
    lock_id = db.execute("""
        INSERT INTO router_locks 
        (router_id, worker_id, acquired_at, expires_at)
        VALUES (?, ?, NOW(), NOW() + INTERVAL 45 MINUTE)
    """)
    
    try:
        # Update job to EXECUTING
        db.execute("""
            UPDATE jobs SET state='EXECUTING' WHERE id=? AND tenant_id=?
        """, (job_id, current_tenant_id))
        
        # Do work...
        result = apply_and_verify(router_id, job_config)
        
        # Finalize (atomic)
        db.execute("""
            BEGIN;
            UPDATE jobs SET state='SUCCESS' WHERE id=?;
            DELETE FROM router_locks WHERE router_id=?;
            COMMIT;
        """)
    except Exception as e:
        # Release lock, mark failed
        db.execute("DELETE FROM router_locks WHERE router_id=?")
        db.execute("""
            UPDATE jobs SET state='FAILED', error=? WHERE id=?
        """, (str(e), job_id))
        raise
```

---

**End of Checklist. Use this as your north star during implementation.**
