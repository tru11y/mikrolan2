# MikroLan V1 Quarantine System

## Overview

The Quarantine system is a **device-level safety mechanism** that isolates routers with repeated failures from automatic job execution. It preserves operator control (manual release only) while preventing cascading failures across the infrastructure.

**Key Design Principles:**
- Device-scoped, not global
- Failure-driven entry (not time-based)
- Three escalating levels (L1, L2, L3)
- Manual release only (no auto-recovery)
- Complete audit trail for every state change
- No redesign of Job Engine or Mobile concerns

---

## 1. DATA MODEL

### Quarantine State Table

```sql
CREATE TABLE IF NOT EXISTS quarantine_state (
    id TEXT PRIMARY KEY,                    -- quarantine_state:<router_id>
    router_id TEXT NOT NULL UNIQUE,
    tenant_id TEXT NOT NULL,
    level INTEGER DEFAULT 0,                -- 0 (none), 1, 2, 3
    consecutive_failures INTEGER DEFAULT 0, -- Count of consecutive job failures
    triggered_by_job_id TEXT,               -- First job that triggered quarantine
    last_failure_at TIMESTAMP,              -- Timestamp of most recent failure
    quarantined_at TIMESTAMP,               -- When quarantine was entered (NULL if level=0)
    reason TEXT,                            -- Why quarantined (e.g., "3 consecutive apply failures")
    blocked_job_types TEXT,                 -- JSON array of blocked job types per level
    release_reason TEXT,                    -- Why it was released (set on exit)
    released_at TIMESTAMP,                  -- When quarantine was exited
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (router_id) REFERENCES routers(id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

### Quarantine Event Log

```sql
CREATE TABLE IF NOT EXISTS quarantine_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    router_id TEXT NOT NULL,
    event_type TEXT NOT NULL,              -- "entered_l1", "entered_l2", "entered_l3", "released"
    level_before INTEGER,
    level_after INTEGER,
    triggered_by TEXT,                      -- "job_failure", "manual_escalation", etc.
    triggered_by_id TEXT,                   -- job_id or operator_id
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (router_id) REFERENCES routers(id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

---

## 2. QUARANTINE LEVELS

### Level 0 (None)
- **Status:** Router is operational, no restrictions.
- **Jobs:** All job types accepted.
- **Entry:** Default state; router in ONLINE status.

### Level 1 (Caution)
- **Trigger:** 2 consecutive job failures on same router.
- **Jobs Allowed:** `verify` only (read-only health check).
- **Jobs Blocked:** `apply`, `rollback`.
- **Intent:** Prevent further automated changes; require operator review before proceeding.
- **Duration:** Manual release or automatic escalation to L2 after 3rd failure.

### Level 2 (Warning)
- **Trigger:** 3 consecutive job failures (or manual escalation from L1).
- **Jobs Allowed:** None (all job types blocked).
- **Jobs Blocked:** `apply`, `verify`, `rollback`.
- **Intent:** Halt all operations; operator must intervene.
- **Duration:** Manual release only (operator must explicitly review and approve).

### Level 3 (Critical)
- **Trigger:** 4+ consecutive job failures, or manual escalation by operator with elevated reason.
- **Jobs Allowed:** None (all job types blocked).
- **Jobs Blocked:** `apply`, `verify`, `rollback`.
- **Intent:** Critical failure state; device requires field investigation or special remediation.
- **Duration:** Manual release only; operator documents why device is safe.

---

## 3. ENTRY CONDITIONS

### Failure Counters

**Consecutive Failure Counter:**
- Incremented on: Any job transitions to `failed` status.
- Reset on: Any job transitions to `success` status.
- Scope: Per router, across all job types.

**State Transitions (Example):**

```
Job 1 fails → consecutive_failures = 1 → Level 0 (normal)
Job 2 fails → consecutive_failures = 2 → AUTO-ENTER Level 1
Job 3 fails → consecutive_failures = 3 → AUTO-ESCALATE to Level 2
Job 4 fails → consecutive_failures = 4 → AUTO-ESCALATE to Level 3

Job N succeeds → consecutive_failures = 0 → Level unchanged (manual release required)
```

### Entry Paths

| Event | Condition | Action | Destination |
|-------|-----------|--------|-------------|
| Job failure | consecutive_failures == 2 | Auto-enter quarantine | L1 |
| Job failure | consecutive_failures == 3 | Auto-escalate | L2 |
| Job failure | consecutive_failures >= 4 | Auto-escalate | L3 |
| Operator action | Manual escalation request | Escalate with reason | L2 or L3 |
| Manual override | Operator decision | Force entry | Any level |

### Failure Definition

A job is considered **failed** if:
- Job status is `failed` after job completion.
- Job status is `failed` due to timeout (API unreachable, hung operation).
- Job status is `failed` due to verification mismatch (desired != actual state).

A job is considered **successful** if:
- Job status is `success` after job completion.
- Verification phase passes (actual state matches desired state).

---

## 4. BLOCKING RULES

### Job Submission Gate

On `POST /api/v1/routers/:id/apply-job` or `POST /api/v1/routers/:id/verify-job`:

```python
def check_quarantine_gate(router_id: str, job_type: str) -> tuple[bool, Optional[str]]:
    """
    Check if job is allowed based on quarantine state.
    Returns (allowed, reason).
    """
    quarantine = get_quarantine_state(router_id)
    
    if quarantine.level == 0:
        return (True, None)
    
    if quarantine.level == 1:
        if job_type == "verify":
            return (True, None)
        else:  # apply, rollback
            return (False, f"Router in quarantine L1: {quarantine.reason}")
    
    if quarantine.level in (2, 3):
        return (False, f"Router in quarantine {quarantine.level}: {quarantine.reason}")
    
    return (False, "Unknown quarantine state")
```

**API Response (403 Forbidden):**
```json
{
  "status": "error",
  "error": {
    "code": "ROUTER_QUARANTINED",
    "message": "Router ISP-US-WEST-001 is in quarantine L2",
    "details": {
      "router_id": "...",
      "quarantine_level": 2,
      "reason": "3 consecutive job failures",
      "consecutive_failures": 3,
      "triggered_by_job_id": "job-123",
      "last_failure_at": "2026-05-05T10:30:00Z",
      "quarantined_at": "2026-05-05T10:32:00Z"
    }
  }
}
```

---

## 5. RELEASE RULES

### Manual Release Only

Release is **always explicit** and **operator-initiated**. No automatic downgrade or time-based escape.

#### Release Endpoint

```
POST /api/v1/routers/:id/release-quarantine
Authorization: Bearer <operator_api_token>
Content-Type: application/json

{
  "reason": "Field tech confirmed device is responsive; replaced faulty interface",
  "target_level": 0,  // Only allow release to level 0 (full restoration)
  "approval_code": "optional-two-factor-token"  // For L3 releases (future)
}
```

**Validations:**
1. Only operator (with `router:write` scope) can release.
2. `reason` is required and must be >10 characters (prevent accidental release).
3. Can only release to level 0 (no partial downgrades).
4. Audit event is created immediately.
5. `consecutive_failures` counter is reset to 0.

**API Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "router_id": "...",
    "quarantine_level": 0,
    "released_at": "2026-05-05T11:00:00Z",
    "release_reason": "Field tech confirmed device is responsive..."
  }
}
```

---

## 6. AUDIT EVENTS

Every quarantine state change generates an immutable audit event.

### Quarantine Event Schema

```json
{
  "id": "audit-uuid",
  "tenant_id": "...",
  "router_id": "...",
  "event_type": "quarantine_entered_l1",  // entered_l1, entered_l2, entered_l3, escalated, released
  "level_before": 0,
  "level_after": 1,
  "triggered_by": "job_failure",  // job_failure, job_timeout, manual_escalation, manual_override
  "triggered_by_id": "job-123",   // job_id or operator_id
  "message": "2 consecutive apply job failures",
  "metadata": {
    "consecutive_failures": 2,
    "previous_level": 0,
    "failure_details": {
      "job_ids": ["job-121", "job-122"],
      "error_summary": "Router offline (timeout)"
    }
  },
  "created_at": "2026-05-05T10:32:00Z"
}
```

### Audit Log Queries

Operators can query quarantine history:
```
GET /api/v1/routers/:id/quarantine-history?limit=50

Response: [quarantine_event, ...]
```

---

## 7. INTEGRATION POINTS

### Job Completion Handler

When a job completes (success or failure), the state machine invokes:

```python
async def on_job_complete(job_id: str, status: str, router_id: str):
    """
    Called after job succeeds or fails.
    Updates quarantine state based on job outcome.
    """
    quarantine = get_quarantine_state(router_id)
    
    if status == "success":
        # Reset consecutive failures
        if quarantine.consecutive_failures > 0:
            update_quarantine(
                router_id=router_id,
                consecutive_failures=0,
                last_failure_at=None
            )
            log_audit_event(
                tenant_id=job.tenant_id,
                router_id=router_id,
                event_type="quarantine_counter_reset",
                triggered_by="job_success",
                triggered_by_id=job_id,
                message=f"Consecutive failure counter reset by successful job {job_id}"
            )
    
    elif status == "failed":
        # Increment failure counter
        new_count = quarantine.consecutive_failures + 1
        update_quarantine(
            router_id=router_id,
            consecutive_failures=new_count,
            last_failure_at=datetime.utcnow(),
            triggered_by_job_id=job_id
        )
        
        # Check entry conditions
        if new_count == 2 and quarantine.level == 0:
            enter_quarantine_l1(router_id, job_id)
        elif new_count == 3 and quarantine.level == 1:
            escalate_to_l2(router_id, job_id)
        elif new_count >= 4 and quarantine.level == 2:
            escalate_to_l3(router_id, job_id)
```

### Job Submission Gate

Before accepting a new job, check quarantine:

```python
@app.post("/api/v1/routers/{router_id}/apply-job")
async def create_apply_job(
    router_id: str,
    config_id: str,
    current_user: str = Depends(auth),
    db: Session = Depends(get_db)
):
    # Validate tenant isolation
    router = db.query(Router).filter_by(id=router_id, tenant_id=current_user.tenant_id).first()
    if not router:
        raise HTTPException(404, "Router not found")
    
    # Check quarantine gate
    allowed, block_reason = check_quarantine_gate(router_id, job_type="apply")
    if not allowed:
        raise HTTPException(403, {
            "code": "ROUTER_QUARANTINED",
            "message": block_reason,
            "details": get_quarantine_state(router_id).as_dict()
        })
    
    # Create job (existing logic)
    job = Job(router_id=router_id, config_id=config_id, type="apply", ...)
    db.add(job)
    db.commit()
    return {"status": "accepted", "job_id": job.id}
```

---

## 8. STATE MACHINE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│ Router online, jobs succeeding                                  │
│ consecutive_failures = 0                                        │
│ LEVEL 0 (Normal)                                                │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ Job 1 fails
                  │ consecutive_failures = 1
                  ▼
          ┌──────────────────────┐
          │ LEVEL 0 (Recovery)   │ ← Waiting for job to succeed
          │ consecutive_failures=1│   (resets counter)
          └──────────┬───────────┘
                     │
                     │ Job 2 fails
                     │ consecutive_failures = 2
                     ▼
    ┌────────────────────────────────────┐
    │ LEVEL 1 (Caution)                  │
    │ - verify jobs allowed              │
    │ - apply/rollback blocked           │
    │ - Audit: "entered L1"              │
    └────────────┬───────────────────────┘
                 │
       ┌─────────┴──────────┐
       │                    │
       │ Job succeeds       │ Job 3 fails
       │ counter=0          │ consecutive_failures=3
       │ (level unchanged)  │
       │                    ▼
       │          ┌──────────────────────┐
       │          │ LEVEL 2 (Warning)    │
       │          │ - all jobs blocked   │
       │          │ - Audit: "escalated" │
       │          └──────────┬───────────┘
       │                     │
       │                     │ Job 4 fails
       │                     │ consecutive_failures=4
       │                     ▼
       │          ┌──────────────────────┐
       │          │ LEVEL 3 (Critical)   │
       │          │ - all jobs blocked   │
       │          │ - manual review req. │
       │          └──────────┬───────────┘
       │                     │
       └─────────┬───────────┴───────────┐
                 │                       │
                 │ Operator calls        │ Operator calls
                 │ /release-quarantine   │ /release-quarantine
                 │ (L1 or L2)            │ (L3)
                 ▼                       ▼
    ┌────────────────────────┐  ┌────────────────────────┐
    │ LEVEL 0 (Released)     │  │ LEVEL 0 (Released)     │
    │ - Audit: "released"    │  │ - Audit: "released"    │
    │ - counter = 0          │  │ - counter = 0          │
    │ - Ready for jobs       │  │ - Ready for jobs       │
    └────────────────────────┘  └────────────────────────┘
```

---

## 9. OPERATOR WORKFLOWS

### Scenario 1: Two failures, catch in L1

```
Time   | Event                      | Quarantine State
-------|----------------------------|------------------
10:30  | Job 1 fails (apply)        | L0, count=1
10:32  | Job 2 fails (apply)        | L1, count=2, blocked
10:35  | Operator views router      | Sees "L1: 2 failures"
10:40  | Operator runs verify job   | ALLOWED (L1 permits verify)
10:41  | Verify job succeeds        | count=0, L1 (no auto-release)
10:50  | Operator calls release     | L0, count=0, ready for apply
```

### Scenario 2: Cascade to L3

```
Time   | Event                      | Quarantine State
-------|----------------------------|------------------
10:00  | Job 1 fails (apply)        | L0, count=1
10:02  | Job 2 fails (apply)        | L1, count=2, blocked
10:05  | Job 3 fails (apply)        | L2, count=3, all blocked
10:08  | Job 4 fails (apply)        | L3, count=4, critical
10:10  | Operator page alerted      | -
10:30  | Operator investigates      | Router unreachable
11:00  | Field tech fixes network   | -
11:10  | Operator releases L3       | L0, count=0, ready
```

### Scenario 3: Manual escalation

```
POST /api/v1/routers/{id}/quarantine/escalate
{
  "target_level": 2,
  "reason": "Precautionary: suspicious traffic pattern detected"
}

Result: L0 → L2 (operator decision, not failure-driven)
Audit: "manual_escalation", triggered_by="operator-user-123"
```

---

## 10. IMPLEMENTATION CHECKLIST

- [ ] Create `quarantine_state` table with indexes (router_id, tenant_id, level)
- [ ] Create `quarantine_events` table (immutable append-only log)
- [ ] Implement `check_quarantine_gate()` function (job submission gate)
- [ ] Implement `on_job_complete()` hook (state transitions)
- [ ] Add quarantine state fields to Router model (for caching/queries)
- [ ] Implement `POST /api/v1/routers/:id/release-quarantine` endpoint
- [ ] Implement `GET /api/v1/routers/:id/quarantine-history` endpoint
- [ ] Implement `POST /api/v1/routers/:id/quarantine/escalate` endpoint (operator action)
- [ ] Update `GET /api/v1/routers/:id/status` to include quarantine info
- [ ] Add quarantine checks to job queue worker (before dequeuing job)
- [ ] Write audit event for each state transition
- [ ] Document quarantine states in mobile app integration spec
- [ ] Add quarantine metrics to monitoring (L1, L2, L3 counts per tenant)

---

## 11. NON-GOALS

- **Auto-recovery:** No auto-downgrade or time-based release.
- **Global quarantine:** Only device-level, never cluster-level.
- **Job redesign:** No changes to Job Engine, state machine, or workflow.
- **Mobile-side logic:** All quarantine logic is backend-only (mobile just shows status).
- **Auto-remediation:** No automatic restart, reboot, or config rollback.
- **Predictive quarantine:** Entry is failure-driven, not predictive.

---

## Conclusion

The Quarantine system is a **defensive isolation mechanism** that gives operators explicit control over when to stop executing jobs on a router. It's designed to prevent cascading failures without hiding problems, preserve auditability, and keep the operator in the loop for recovery decisions.
