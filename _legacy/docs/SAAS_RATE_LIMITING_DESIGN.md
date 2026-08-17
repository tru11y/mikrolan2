# SaaS Router Onboarding: Rate Limiting & Batching Design

## Overview

Scale from 10-50 concurrent onboardings to **thousands of routers safely** using:
- **Tenant-aware** queue system (SQLite/PostgreSQL)
- **Per-tenant rate limits** (e.g., 5-10 concurrent per ISP)
- **Global rate limits** (e.g., 30-50 concurrent total)
- **Fair scheduler** loop that prevents tenant starvation
- **Idempotent, restartable** operations (backend restart-safe)

No Celery, Kafka, or Kubernetes required.

---

## 1. Queue Data Model

### Extended Schema (add to `models.py`)

```sql
-- Tenant table (new)
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,                    -- e.g., "isp-verizon", "isp-orange"
    name TEXT NOT NULL,
    max_concurrent_onboardings INT DEFAULT 5,  -- per-tenant limit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Onboarding queue (replaces ad-hoc task spawning)
CREATE TABLE IF NOT EXISTS onboarding_queue (
    id TEXT PRIMARY KEY,                    -- uuid
    tenant_id TEXT NOT NULL,
    router_id TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',          -- PENDING, RUNNING, DONE, ERROR
    priority INT DEFAULT 0,                 -- optional: fair scheduling by priority
    
    -- API credentials (encrypted)
    router_ip TEXT NOT NULL,
    admin_username TEXT NOT NULL,
    admin_password_encrypted TEXT NOT NULL,
    
    -- Attempt tracking (for retries)
    attempt_count INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    last_error TEXT,
    
    -- Timing
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,                   -- when RUNNING state set
    completed_at TIMESTAMP,                 -- when DONE or ERROR
    
    -- Who's running it
    claimed_by_worker_id TEXT,              -- e.g., "worker-1", hostname
    claimed_at TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (router_id) REFERENCES routers(id)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_queue_status ON onboarding_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_tenant_status ON onboarding_queue(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_claimed ON onboarding_queue(claimed_by_worker_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_priority ON onboarding_queue(priority, created_at);
```

### Updated `routers` Table

```sql
-- Add tenant_id to routers table
ALTER TABLE routers ADD COLUMN tenant_id TEXT;
ALTER TABLE routers ADD FOREIGN KEY (tenant_id) REFERENCES tenants(id);
```

---

## 2. Rate Limiter Logic

### Core Rate Limiter Class

The rate limiter answers: "**Can I start a new onboarding now?**"

```python
class RateLimiter:
    """
    Checks if a new onboarding can start given:
    - Global limit (max concurrent across all tenants)
    - Per-tenant limits (max concurrent per tenant)
    """
    
    def __init__(self, global_limit: int, db_conn):
        self.global_limit = global_limit  # e.g., 50
        self.db = db_conn
    
    def get_global_running_count(self) -> int:
        """Count routers currently RUNNING across all tenants."""
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM onboarding_queue WHERE status = 'RUNNING'"
        )
        return cursor.fetchone()[0]
    
    def get_tenant_running_count(self, tenant_id: str) -> int:
        """Count routers currently RUNNING for a specific tenant."""
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM onboarding_queue WHERE tenant_id = ? AND status = 'RUNNING'",
            (tenant_id,)
        )
        return cursor.fetchone()[0]
    
    def get_tenant_limit(self, tenant_id: str) -> int:
        """Get per-tenant max concurrent onboardings."""
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT max_concurrent_onboardings FROM tenants WHERE id = ?",
            (tenant_id,)
        )
        row = cursor.fetchone()
        return row[0] if row else 5  # default to 5
    
    def can_start_onboarding(self, tenant_id: str) -> tuple[bool, str]:
        """
        Returns (can_start: bool, reason: str)
        
        Check constraints:
        1. Global limit not exceeded
        2. Tenant limit not exceeded
        """
        global_count = self.get_global_running_count()
        if global_count >= self.global_limit:
            return False, f"Global limit reached ({global_count}/{self.global_limit})"
        
        tenant_limit = self.get_tenant_limit(tenant_id)
        tenant_count = self.get_tenant_running_count(tenant_id)
        if tenant_count >= tenant_limit:
            return False, f"Tenant limit reached ({tenant_count}/{tenant_limit})"
        
        return True, "OK"
```

---

## 3. Scheduler Loop

### Key Algorithm: **Fair Scheduling with Batching**

The scheduler runs periodically (e.g., every 30 seconds) and:
1. **Checks constraints** (global + per-tenant limits)
2. **Selects PENDING routers fairly** (round-robin by tenant, FIFO within tenant)
3. **Transitions to RUNNING** (marks as claimed, locks to prevent double-start)
4. **Spawns asyncio tasks** for claimed routers

```python
import asyncio
import uuid
from datetime import datetime
from typing import List
import sqlite3

class OnboardingScheduler:
    """
    Periodically selects and starts onboarding tasks.
    
    Fair scheduling ensures:
    - No tenant starves (round-robin tenant selection)
    - FIFO order within each tenant
    - Respects per-tenant and global limits
    - Idempotent: safe if restarted
    """
    
    def __init__(
        self,
        db_path: str,
        global_limit: int = 50,
        batch_size: int = 10,
        check_interval_sec: int = 30,
        worker_id: str = "scheduler-1"  # hostname or instance ID
    ):
        self.db_path = db_path
        self.global_limit = global_limit
        self.batch_size = batch_size
        self.check_interval_sec = check_interval_sec
        self.worker_id = worker_id
        self.rate_limiter = None
    
    def _get_db(self):
        """Get DB connection."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    def get_active_tenants(self) -> List[str]:
        """Get list of tenants that have PENDING onboardings (for fair round-robin)."""
        conn = self._get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT tenant_id FROM onboarding_queue
            WHERE status = 'PENDING'
            ORDER BY tenant_id
        """)
        tenants = [row[0] for row in cursor.fetchall()]
        conn.close()
        return tenants
    
    def get_pending_for_tenant(self, tenant_id: str, limit: int = 1):
        """Get PENDING routers for a tenant (FIFO by created_at)."""
        conn = self._get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, router_id, tenant_id FROM onboarding_queue
            WHERE tenant_id = ? AND status = 'PENDING'
            ORDER BY priority DESC, created_at ASC
            LIMIT ?
        """, (tenant_id, limit))
        rows = cursor.fetchall()
        conn.close()
        return rows
    
    def claim_and_run_queue_item(self, queue_id: str) -> bool:
        """
        Atomically transition queue item from PENDING → RUNNING.
        Returns True if successful, False if someone else claimed it.
        """
        conn = self._get_db()
        cursor = conn.cursor()
        now = datetime.utcnow().isoformat()
        
        # Only claim if still PENDING (prevents race conditions)
        cursor.execute("""
            UPDATE onboarding_queue
            SET status = 'RUNNING',
                claimed_by_worker_id = ?,
                claimed_at = ?,
                started_at = ?
            WHERE id = ? AND status = 'PENDING'
        """, (self.worker_id, now, now, queue_id))
        
        affected = cursor.rowcount
        conn.commit()
        conn.close()
        
        return affected > 0  # True if this worker claimed it
    
    async def scheduler_loop(self):
        """
        Main loop: periodically select and start onboarding tasks.
        
        Algorithm:
        1. Get all tenants with PENDING routers (round-robin)
        2. For each tenant:
           a. Check if tenant + global limits allow starting
           b. Select up to N PENDING routers (FIFO)
           c. Try to claim them (atomic transition to RUNNING)
           d. Spawn asyncio tasks for claimed routers
        3. Wait check_interval_sec, then repeat
        """
        self.rate_limiter = RateLimiter(self.global_limit, self._get_db())
        
        print(f"[Scheduler] Starting with global_limit={self.global_limit}, "
              f"batch_size={self.batch_size}, check_interval={self.check_interval_sec}s")
        
        while True:
            try:
                await self._scheduler_tick()
            except Exception as e:
                print(f"[Scheduler] ERROR in tick: {e}")
                import traceback
                traceback.print_exc()
            
            await asyncio.sleep(self.check_interval_sec)
    
    async def _scheduler_tick(self):
        """One iteration of the scheduler."""
        start_time = datetime.utcnow()
        
        # Get tenants with pending work (ensures fair round-robin)
        active_tenants = self.get_active_tenants()
        if not active_tenants:
            return  # Nothing to do
        
        claimed_count = 0
        
        # Round-robin: each tenant gets a chance
        for tenant_id in active_tenants:
            # Check if we can start for this tenant
            can_start, reason = self.rate_limiter.can_start_onboarding(tenant_id)
            if not can_start:
                print(f"[Scheduler] Tenant {tenant_id}: {reason}")
                continue
            
            # How many can we start for this tenant?
            tenant_limit = self.rate_limiter.get_tenant_limit(tenant_id)
            tenant_running = self.rate_limiter.get_tenant_running_count(tenant_id)
            slots_available = tenant_limit - tenant_running
            
            # How many global slots available?
            global_running = self.rate_limiter.get_global_running_count()
            global_slots = self.global_limit - global_running
            
            # Take minimum of: global slots, tenant slots, batch size
            can_claim = min(global_slots, slots_available, self.batch_size)
            
            if can_claim <= 0:
                continue
            
            # Get pending routers for this tenant
            pending = self.get_pending_for_tenant(tenant_id, limit=can_claim)
            if not pending:
                continue
            
            # Try to claim each one
            for row in pending:
                queue_id = row[0]
                router_id = row[1]
                
                claimed = self.claim_and_run_queue_item(queue_id)
                if claimed:
                    print(f"[Scheduler] Claimed {router_id} (tenant={tenant_id})")
                    # Spawn the actual onboarding task
                    asyncio.create_task(
                        self._run_onboarding_task(queue_id, router_id, tenant_id)
                    )
                    claimed_count += 1
                else:
                    # Someone else claimed it (race condition, fine)
                    print(f"[Scheduler] {router_id} already claimed by another worker")
        
        elapsed = (datetime.utcnow() - start_time).total_seconds()
        if claimed_count > 0:
            print(f"[Scheduler] Tick: claimed {claimed_count} routers in {elapsed:.2f}s")
    
    async def _run_onboarding_task(self, queue_id: str, router_id: str, tenant_id: str):
        """
        Run the actual onboarding worker for a router.
        Update queue status when done.
        """
        try:
            # Import your existing onboarding_worker
            from onboarding import onboarding_worker
            
            # Get router details from DB
            conn = self._get_db()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT ip, username, password_encrypted FROM routers WHERE id = ?
            """, (router_id,))
            row = cursor.fetchone()
            conn.close()
            
            if not row:
                self._mark_queue_error(queue_id, "Router not found in DB")
                return
            
            router_ip, username, password_encrypted = row
            
            # Run onboarding
            backend_wg_pubkey = "1XQ53CfYH/AyDdWpTZXK0dVMdda9dqPcA3Gh1F8D4Bo="
            await onboarding_worker(router_id, backend_wg_pubkey)
            
            # Mark queue item as DONE
            self._mark_queue_done(queue_id)
            print(f"[Onboarding] Completed {router_id}")
            
        except Exception as e:
            print(f"[Onboarding] Failed {router_id}: {e}")
            self._mark_queue_error(queue_id, str(e))
    
    def _mark_queue_done(self, queue_id: str):
        """Mark queue item as DONE."""
        conn = self._get_db()
        cursor = conn.cursor()
        now = datetime.utcnow().isoformat()
        cursor.execute("""
            UPDATE onboarding_queue
            SET status = 'DONE', completed_at = ?
            WHERE id = ?
        """, (now, queue_id))
        conn.commit()
        conn.close()
    
    def _mark_queue_error(self, queue_id: str, error: str):
        """Mark queue item as ERROR (with retry logic if needed)."""
        conn = self._get_db()
        cursor = conn.cursor()
        now = datetime.utcnow().isoformat()
        
        # Get current attempt count
        cursor.execute("""
            SELECT attempt_count, max_attempts FROM onboarding_queue WHERE id = ?
        """, (queue_id,))
        row = cursor.fetchone()
        
        if row:
            attempt_count, max_attempts = row
            attempt_count += 1
            
            if attempt_count < max_attempts:
                # Retry: reset to PENDING
                cursor.execute("""
                    UPDATE onboarding_queue
                    SET status = 'PENDING',
                        attempt_count = ?,
                        last_error = ?,
                        claimed_by_worker_id = NULL,
                        claimed_at = NULL
                    WHERE id = ?
                """, (attempt_count, error, queue_id))
                print(f"[Queue] {queue_id} will retry (attempt {attempt_count}/{max_attempts})")
            else:
                # Final failure
                cursor.execute("""
                    UPDATE onboarding_queue
                    SET status = 'ERROR',
                        attempt_count = ?,
                        last_error = ?,
                        completed_at = ?
                    WHERE id = ?
                """, (attempt_count, error, now, queue_id))
                print(f"[Queue] {queue_id} failed permanently after {attempt_count} attempts")
        
        conn.commit()
        conn.close()
```

---

## 4. Integration: API & Background Loop

### Updated FastAPI app structure

```python
import asyncio
import uuid
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

app = FastAPI()
scheduler = None

class QueueOnboardRequest(BaseModel):
    tenant_id: str
    router_ip: str
    admin_username: str
    admin_password_encrypted: str  # encrypted client-side


class QueueOnboardResponse(BaseModel):
    queue_id: str
    status: str
    message: str


@app.post("/queue/onboard", response_model=QueueOnboardResponse)
async def queue_onboarding(req: QueueOnboardRequest):
    """
    Add router to onboarding queue (non-blocking).
    
    Instead of waiting 5-10 minutes for onboarding,
    clients submit routers to the queue and poll for status.
    """
    conn = sqlite3.connect("routers.db")
    cursor = conn.cursor()
    
    # Validate tenant exists
    cursor.execute("SELECT id FROM tenants WHERE id = ?", (req.tenant_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Tenant not found")
    
    # Create queue entry
    queue_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    cursor.execute("""
        INSERT INTO onboarding_queue
        (id, tenant_id, router_ip, admin_username, admin_password_encrypted, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (queue_id, req.tenant_id, req.router_ip, req.admin_username,
          req.admin_password_encrypted, now))
    
    conn.commit()
    conn.close()
    
    return QueueOnboardResponse(
        queue_id=queue_id,
        status="PENDING",
        message="Router added to onboarding queue"
    )


@app.get("/queue/status/{queue_id}")
async def queue_status(queue_id: str):
    """Poll for onboarding status."""
    conn = sqlite3.connect("routers.db")
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT status, created_at, started_at, completed_at, last_error
        FROM onboarding_queue WHERE id = ?
    """, (queue_id,))
    
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Queue item not found")
    
    status, created_at, started_at, completed_at, last_error = row
    
    return {
        "queue_id": queue_id,
        "status": status,
        "created_at": created_at,
        "started_at": started_at,
        "completed_at": completed_at,
        "error": last_error
    }


@app.on_event("startup")
async def startup_event():
    """Start the scheduler loop on app startup."""
    global scheduler
    
    scheduler = OnboardingScheduler(
        db_path="routers.db",
        global_limit=50,          # ISP-scale
        batch_size=10,            # process 10 at a time
        check_interval_sec=30,    # every 30 seconds
        worker_id="main-worker"
    )
    
    # Run scheduler in background
    asyncio.create_task(scheduler.scheduler_loop())
    print("[App] Scheduler started in background")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## 5. Examples

### Example 1: Onboard 1000 Routers Safely

**Timeline:**
- `t=0s`: Client submits 1000 routers via `/queue/onboard`
  - All 1000 added to queue with status=PENDING
  - Returns immediately (queue_id for each)
  
- `t=30s`: Scheduler tick #1
  - Global: 50 slots available
  - Tenant A: has 300 pending, limit=10 → claim 10
  - Tenant B: has 200 pending, limit=8 → claim 8
  - Tenant C: has 500 pending, limit=5 → claim 5
  - (etc., round-robin)
  - Result: 50 routers → RUNNING (global limit hit)
  - 950 remain PENDING
  
- `t=60s`: Scheduler tick #2
  - Some routers finish (say 5 complete)
  - Global: 45 running, 5 slots available
  - Schedule 5 more PENDING routers
  - Remaining: 945 PENDING
  
- **Pattern continues**: Every 30s, 50-100 routers advance, balanced per-tenant
  - At ~20 routers/min average, 1000 routers takes ~50 minutes
  - Smoothly distributed, no overload, fair to all tenants

### Example 2: Two Tenants Onboarding Simultaneously

**Setup:**
- Tenant A: limit=10, has 100 pending
- Tenant B: limit=8, has 80 pending
- Global: limit=50

**t=30s (Tick #1):**
```
Active tenants: [A, B]
Round-robin:
  Tenant A: 0 running, limit 10 → claim 10
  Tenant B: 0 running, limit 8 → claim 8
Global check: 18 < 50 ✓
Result:
  Tenant A: 10 RUNNING
  Tenant B: 8 RUNNING
  Total: 18 RUNNING
```

**t=60s (Tick #2):**
Assume Tenant A completes 3 routers, Tenant B completes 2:
```
Active tenants: [A, B]
  Tenant A: 7 running, 10 limit → can claim 3 more → claim 3
  Tenant B: 6 running, 8 limit → can claim 2 more → claim 2
Global check: 7+6+3+2 = 18 < 50 ✓
Result:
  Tenant A: 10 RUNNING (7 old + 3 new)
  Tenant B: 8 RUNNING (6 old + 2 new)
  Total: 18 RUNNING
```

**Key insight:** Each tenant stays at their limit until the queue drains. No tenant starves another.

---

## 6. Why This Avoids Overload & Lockouts

### 1. **No Overload**
- **Global limit enforced**: max 50 concurrent tasks, capped by asyncio event loop capacity
- **Per-tenant limit enforced**: prevents one ISP from hogging all workers
- **Batching prevents thundering herd**: only 10 new tasks every 30 seconds (not thousands at once)

### 2. **Fair Scheduling**
- **Round-robin by tenant**: each tenant's PENDING queue is visited in order
- **FIFO within tenant**: routers are processed in submission order
- **No starvation**: if a tenant has pending work, they will eventually get slots

### 3. **Restart-Safe (Idempotent)**
- **Queue transitions are atomic**: UPDATE with WHERE status='PENDING' prevents double-claiming
- **claimed_by_worker_id**: if scheduler crashes, tasks stay marked RUNNING but not actually running
  - Next startup: scheduler sees orphaned RUNNING items and either:
    - Retries them (if timeout logic added)
    - Leaves them for human inspection
- **Attempt counter**: automatic retry (up to max_attempts) before marking ERROR

### 4. **Backpressure & Graceful Degradation**
- If onboarding is slow (routers take 10 min each):
  - Only 5 slots free every 30s (50 limit / ~3 min average)
  - Queue grows, but system stable (no task explosion)
- If routers fail:
  - Failed ones retry automatically (up to max_attempts)
  - System doesn't cascade-fail

### 5. **Operator Visibility**
```sql
-- Dashboard queries

-- How many routers are we processing right now?
SELECT status, COUNT(*) FROM onboarding_queue GROUP BY status;

-- Which tenant is hitting limits?
SELECT tenant_id, 
       COUNT(CASE WHEN status='RUNNING' THEN 1 END) as running,
       COUNT(CASE WHEN status='PENDING' THEN 1 END) as pending
FROM onboarding_queue
GROUP BY tenant_id;

-- Slow routers (still running for >5 min)?
SELECT router_id, tenant_id, started_at 
FROM onboarding_queue 
WHERE status='RUNNING' AND started_at < datetime('now', '-5 minutes');

-- Error rate?
SELECT tenant_id, 
       COUNT(CASE WHEN status='ERROR' THEN 1 END) as errors
FROM onboarding_queue
GROUP BY tenant_id;
```

---

## 7. Configuration & Tuning

| Parameter | Default | Notes |
|-----------|---------|-------|
| `global_limit` | 50 | Total concurrent onboardings across all ISPs |
| `batch_size` | 10 | Max routers to claim per scheduler tick |
| `check_interval_sec` | 30 | Scheduler runs every 30s |
| `max_attempts` (per router) | 3 | Retry failed onboardings up to 3 times |
| `per_tenant_limit` | 5-10 | Set per-tenant in DB (not code) |

**For ISP Scale (5000+ routers/month):**
- Increase `global_limit` to 100-200 (more concurrent tasks)
- Reduce `check_interval_sec` to 15-20s (more aggressive scheduling)
- Set `batch_size` to 20-30

**For Stability (risk-averse):**
- Decrease `global_limit` to 30
- Increase `check_interval_sec` to 60s
- Set `batch_size` to 5

---

## 8. Testing Checklist

- [ ] Single tenant, 100 routers → all complete in expected time
- [ ] Two tenants, 50+50 routers → both get fair slots, no starvation
- [ ] Global limit cap: verify never > 50 concurrent
- [ ] Per-tenant limit cap: verify never > X concurrent for tenant
- [ ] Scheduler restart: orphaned RUNNING items handled gracefully
- [ ] Network failure mid-onboarding: retry logic kicks in
- [ ] DB query performance: indices speed up PENDING selection
- [ ] Fairness metric: calculate % time each tenant has available slots

---

## Summary

| Aspect | Solution |
|--------|----------|
| **Queueing** | Database table with PENDING/RUNNING/DONE/ERROR states |
| **Rate Limiting** | RateLimiter class checks global + per-tenant limits |
| **Batching** | Scheduler claims N routers every 30s, respects limits |
| **Fair Scheduling** | Round-robin by tenant, FIFO within tenant |
| **Restart Safety** | Atomic transitions, worker ID tracking, retry counter |
| **Scalability** | From 10s to 1000s of routers, no code changes needed |

This design scales to **ISP-level (5000+ routers/month)** without Celery, Kafka, or k8s.
