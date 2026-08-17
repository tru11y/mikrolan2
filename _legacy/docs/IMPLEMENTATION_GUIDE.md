# SaaS Rate Limiting Implementation Guide

## Quick Start

### 1. Files Added

```
├── SAAS_RATE_LIMITING_DESIGN.md    # Complete design document (read first)
├── models_saas.py                   # Database schema + ORM
├── rate_limiter.py                  # Rate limiter logic
├── scheduler.py                     # Scheduler loop
├── app_saas.py                      # FastAPI app with queue endpoints
├── example_saas_usage.py            # Demo & examples
└── IMPLEMENTATION_GUIDE.md          # This file
```

### 2. Initialize the System

```python
# In your app startup:
from models_saas import init_db_saas
from scheduler import OnboardingScheduler

init_db_saas()  # Creates tables and indexes

scheduler = OnboardingScheduler(
    db_path="routers.db",
    global_limit=50,          # max concurrent onboardings
    batch_size=10,            # claim N routers per tick
    check_interval_sec=30,    # check every 30 seconds
)
asyncio.create_task(scheduler.scheduler_loop())
```

### 3. Create Tenants

```python
from models_saas import create_tenant

isp_a = create_tenant("isp-alpha", "Alpha ISP", max_concurrent=10)
isp_b = create_tenant("isp-beta", "Beta ISP", max_concurrent=8)
```

### 4. Queue Routers

Instead of:
```python
# OLD: synchronous, blocks caller for 5-10 minutes
await onboarding_worker(router_id)
```

Use:
```python
# NEW: async, returns immediately
from models_saas import create_queue_item

queue_item = create_queue_item(
    tenant_id="isp-alpha",
    router_ip="192.168.1.1",
    admin_username="admin",
    admin_password_encrypted="...",  # encrypt before sending
    priority=0,  # optional: higher = sooner
)
print(f"Queue ID: {queue_item.id}")  # client polls this
```

### 5. Poll for Status

```python
# Client polls (no blocking):
GET /queue/status/{queue_id}

Response:
{
  "queue_id": "...",
  "status": "PENDING",  // or RUNNING, DONE, ERROR
  "created_at": "2026-05-05T10:00:00",
  "started_at": null,
  "completed_at": null,
  "error": null
}
```

---

## Architecture

### Database Schema

**Key tables:**

| Table | Purpose |
|-------|---------|
| `tenants` | ISP/client definitions (id, name, max_concurrent_onboardings) |
| `onboarding_queue` | Queue of routers to onboard (PENDING/RUNNING/DONE/ERROR) |
| `routers` | Router metadata (updated with tenant_id) |
| `onboarding_logs` | Detailed logs per step |

**Key indexes:**

```sql
CREATE INDEX idx_queue_status ON onboarding_queue(status);
CREATE INDEX idx_queue_tenant_status ON onboarding_queue(tenant_id, status);
CREATE INDEX idx_queue_claimed ON onboarding_queue(claimed_by_worker_id, status);
CREATE INDEX idx_queue_priority ON onboarding_queue(priority DESC, created_at ASC);
```

### Components

#### 1. **RateLimiter** (`rate_limiter.py`)
- Checks if a new onboarding can start
- Enforces global limit (max 50 concurrent)
- Enforces per-tenant limit (max 5-10 concurrent)
- Calculates available slots

```python
limiter = RateLimiter(global_limit=50, db_path="routers.db")
can_start, reason = limiter.can_start_onboarding("isp-alpha")
available = limiter.get_available_slots("isp-alpha")
```

#### 2. **OnboardingScheduler** (`scheduler.py`)
- Periodically (every 30s) checks the queue
- Selects PENDING routers fairly (round-robin by tenant, FIFO within tenant)
- Respects rate limits (global + per-tenant)
- Claims routers (atomic PENDING → RUNNING transition)
- Spawns asyncio tasks for onboarding
- Handles retries and errors

```python
scheduler = OnboardingScheduler(
    db_path="routers.db",
    global_limit=50,
    batch_size=10,
    check_interval_sec=30,
)
asyncio.create_task(scheduler.scheduler_loop())
```

#### 3. **FastAPI App** (`app_saas.py`)
Endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/queue/onboard` | POST | Add router to queue |
| `/queue/status/{queue_id}` | GET | Poll for status |
| `/queue/stats` | GET | Get queue statistics |
| `/admin/tenants` | POST | Create tenant |
| `/admin/tenants/{tenant_id}` | GET | Get tenant info |
| `/health` | GET | Health check |

---

## How It Works (Step-by-Step)

### Timeline: Onboarding 1000 routers

```
t=0s:
  Client POSTs 1000 routers via /queue/onboard
  → All 1000 added to DB with status=PENDING
  → Returns immediately (queue_id for each)

t=30s (Scheduler Tick #1):
  Global running: 0, available: 50
  Tenant A: has 600 pending, limit=10, available=10
  Tenant B: has 400 pending, limit=8, available=8
  (other tenants...)
  
  Round-robin: Claim 50 total
    - Tenant A: claim 10 (A has 10 slots available)
    - Tenant B: claim 8 (B has 8 slots available)
    - Tenant C: claim 5 (if exists)
    - ... round-robin until 50 claimed or PENDING empty
  
  → Transition 50 queue items PENDING → RUNNING
  → Spawn 50 asyncio onboarding tasks
  → Log: "Claimed 50 routers"

t=60s (Scheduler Tick #2):
  Global running: 50, available: 0 (if slow routers)
  OR some routers completed:
    - 5 routers transitioned RUNNING → DONE
  
  Global running: 45, available: 5
  
  Round-robin again: Claim 5 more
    - Claim from tenants with PENDING
    - Respect limits
  
  → Transition 5 more to RUNNING
  → Spawn 5 more tasks

...continues every 30s until all 1000 are DONE...

t=600s (~10 min):
  Assuming ~50 routers/min complete:
  500 DONE, 500 still in PENDING/RUNNING
  
t=1200s (~20 min):
  1000 DONE (all completed or failed)
```

### Fairness Guarantee

**Per-tenant rate limits prevent hogging:**

```
Tick T:
  Global: 50 slots available
  Tenant A: limit=10, running=0 → can claim 10
  Tenant B: limit=8, running=0 → can claim 8
  Tenant C: limit=5, running=0 → can claim 5
  Tenant D: limit=5, running=0 → can claim 5
  Tenant E: limit=5, running=0 → can claim 5
  ...
  
  Even if Tenant A has 1000 pending, it only claims 10.
  Other tenants get fair chances.
```

### Restart Safety

**If scheduler crashes and restarts:**

1. Queue items marked RUNNING stay RUNNING
2. Scheduler won't try to claim them again (status ≠ PENDING)
3. If you add timeout logic:
   - Mark items as orphaned if RUNNING > 5 min without updates
   - Transition back to PENDING (will retry)

**If a specific onboarding task fails:**

1. Exception caught in `_run_onboarding_task()`
2. `mark_queue_error()` increments attempt_count
3. If attempt_count < max_attempts: reset to PENDING (retry later)
4. If attempt_count ≥ max_attempts: mark as ERROR (give up)

---

## Configuration

### Global Parameters

Edit in `app_saas.py` or pass to `OnboardingScheduler`:

```python
scheduler = OnboardingScheduler(
    db_path="routers.db",          # Database file
    global_limit=50,               # Max concurrent across all tenants
    batch_size=10,                 # Max routers to claim per tick
    check_interval_sec=30,         # Scheduler frequency (seconds)
    worker_id="worker-1",          # Identifier for this instance
)
```

### Per-Tenant Parameters

Set in `tenants` table (database):

```python
from models_saas import create_tenant

create_tenant(
    tenant_id="isp-alpha",
    name="Alpha ISP",
    max_concurrent_onboardings=10  # Per-tenant limit
)
```

### Tuning for Scale

| Scenario | global_limit | batch_size | check_interval_sec |
|----------|--------------|------------|-------------------|
| Development (safe) | 20 | 5 | 60 |
| Moderate (50-100 routers/day) | 50 | 10 | 30 |
| High (1000+ routers/day, ISP-scale) | 100-200 | 20-30 | 15-20 |
| Risk-averse | 30 | 5 | 60 |

---

## Monitoring & Operators

### Queue Statistics

```python
from models_saas import get_queue_stats

# Global stats
stats = get_queue_stats()
# → {"PENDING": 500, "RUNNING": 50, "DONE": 400, "ERROR": 10}

# Per-tenant stats
stats = get_queue_stats(tenant_id="isp-alpha")
# → {"PENDING": 200, "RUNNING": 10, "DONE": 300, "ERROR": 5}
```

### SQL Dashboards

```sql
-- How many routers are we processing?
SELECT status, COUNT(*) FROM onboarding_queue GROUP BY status;

-- Queue depth by tenant
SELECT tenant_id,
       COUNT(CASE WHEN status='PENDING' THEN 1 END) as queue_depth,
       COUNT(CASE WHEN status='RUNNING' THEN 1 END) as running
FROM onboarding_queue GROUP BY tenant_id;

-- Which routers are stuck (running >10 min)?
SELECT router_ip, tenant_id, started_at
FROM onboarding_queue
WHERE status='RUNNING' AND started_at < datetime('now', '-10 minutes');

-- Error rate per tenant
SELECT tenant_id,
       COUNT(CASE WHEN status='ERROR' THEN 1 END) as errors,
       COUNT(*) as total,
       ROUND(100.0 * COUNT(CASE WHEN status='ERROR' THEN 1 END) / COUNT(*), 2) as error_pct
FROM onboarding_queue
WHERE completed_at IS NOT NULL
GROUP BY tenant_id;
```

### Logs

The scheduler logs key events:

```
[Scheduler] Starting: global_limit=50, batch_size=10, check_interval=30s
[Scheduler] Tick: claimed 50 routers in 0.234s, global running=50
[Queue] {queue_id}: retry attempt 1/3 after error: ...
[Queue] {queue_id}: PERMANENT ERROR after 3 attempts
[Onboarding] ✓ Completed 192.168.1.1 (queue_id=abc123...)
[Onboarding] ✗ Failed 192.168.1.2 (queue_id=def456...): Connection timeout
```

---

## Integration Checklist

- [ ] Add `models_saas.py`, `rate_limiter.py`, `scheduler.py` to project
- [ ] Replace `app.py` with `app_saas.py` (or merge endpoints)
- [ ] Call `init_db_saas()` on startup
- [ ] Create tenants via API or script
- [ ] Update client code to use `/queue/onboard` instead of direct onboarding
- [ ] Update client to poll `/queue/status/{queue_id}` instead of waiting
- [ ] Test with example routers:
  ```bash
  python example_saas_usage.py
  ```
- [ ] Deploy and monitor queue stats
- [ ] Tune `global_limit`, `batch_size`, per-tenant limits based on observations

---

## Example Client Code

```python
import requests
import time

API_URL = "http://localhost:8000"

# Create tenant (once, admin)
requests.post(f"{API_URL}/admin/tenants", json={
    "tenant_id": "isp-mycompany",
    "name": "My Company",
    "max_concurrent_onboardings": 10
})

# Queue a router (from client app)
resp = requests.post(f"{API_URL}/queue/onboard", json={
    "tenant_id": "isp-mycompany",
    "router_ip": "192.168.1.100",
    "admin_username": "admin",
    "admin_password_encrypted": "encrypted_password_here",
})
queue_id = resp.json()["queue_id"]
print(f"Queued: {queue_id}")

# Poll for status
while True:
    resp = requests.get(f"{API_URL}/queue/status/{queue_id}")
    status = resp.json()
    print(f"Status: {status['status']}")
    
    if status['status'] in ["DONE", "ERROR"]:
        if status['status'] == "ERROR":
            print(f"Failed: {status['error']}")
        break
    
    time.sleep(5)  # Poll every 5 seconds

print("Onboarding complete!")
```

---

## Troubleshooting

### Routers stuck in RUNNING

**Symptom:** Router has status=RUNNING for >10 min.

**Causes:**
1. Onboarding task crashed silently
2. Network issue (router unreachable)
3. Long onboarding (normal if router is slow)

**Fix:**
- Add timeout logic to mark as ERROR after 5 min (see SAAS_RATE_LIMITING_DESIGN.md)
- Check logs for exceptions
- Verify network connectivity to router

### Global limit not enforced

**Symptom:** More than 50 routers RUNNING at once.

**Cause:** Multiple scheduler instances running, or scheduler crashed mid-tick.

**Fix:**
1. Ensure only one scheduler instance running
2. Add locking if multiple instances (Redis lock, DB-based lock)
3. Check scheduler logs for errors

### Per-tenant limit not enforced

**Symptom:** Tenant A has 15 routers RUNNING despite limit=10.

**Cause:** Per-tenant limit not set correctly in DB.

**Fix:**
```sql
UPDATE tenants SET max_concurrent_onboardings = 10 WHERE id = 'isp-alpha';
```

---

## Next Steps

1. **Read** `SAAS_RATE_LIMITING_DESIGN.md` for full architecture
2. **Run** `example_saas_usage.py` to see it in action
3. **Integrate** files into your project
4. **Test** with 10, 100, 1000 routers
5. **Monitor** queue stats and adjust limits
6. **Deploy** and scale to ISP levels (5000+ routers/month)

---

## Files Reference

| File | Purpose | Key Classes/Functions |
|------|---------|---------------------|
| `models_saas.py` | DB schema + ORM | `Tenant`, `OnboardingQueueItem`, `init_db_saas()`, `create_queue_item()` |
| `rate_limiter.py` | Rate limiting logic | `RateLimiter` |
| `scheduler.py` | Scheduler loop | `OnboardingScheduler`, `scheduler_loop()` |
| `app_saas.py` | FastAPI app | `/queue/onboard`, `/queue/status`, `/queue/stats`, `/admin/tenants` |
| `example_saas_usage.py` | Demo + examples | (executable examples) |
| `SAAS_RATE_LIMITING_DESIGN.md` | Design document | (design, examples, logic) |
| `IMPLEMENTATION_GUIDE.md` | This guide | (integration, monitoring, tuning) |
