# Concurrency Model: Safe Parallel Router Onboarding

## Problem

We need to onboard 10–50 routers **simultaneously** without:
- Global locks (contention)
- Shared mutable state (race conditions)
- One router's failure blocking others

## Solution: Task-Per-Router + Database as Lock-Free Coordinator

### Core Design

```
┌─────────────────────────────────────────────────┐
│ FastAPI (single thread event loop)              │
│ POST /routers/onboard                           │
│  → spawn_onboarding_task(router_id)             │
│  → asyncio.create_task() [non-blocking]         │
│  → return immediately                           │
└──────────┬──────────────────────────────────────┘
           │
           ├─► Task 1: onboarding_worker(router1)
           │    └─ NEW → API_OK → WG_READY → TUNNEL_UP → LOCKED → DONE
           │    └ Runs concurrently, yields on I/O
           │
           ├─► Task 2: onboarding_worker(router2)
           │    └─ NEW → API_OK → ... (independent state machine)
           │
           ├─► Task 3: onboarding_worker(router3)
           │
           └─► Task N: onboarding_worker(routerN)
                └─ All tasks share CPU via asyncio.sleep() yields
                └ Database updates are atomic per-router
```

### Why This Works

**1. No Global Locks**
- Each router has its own task.
- Tasks don't lock a global resource; they only read/write their own DB row.
- SQLite/PostgreSQL handle isolation automatically.

**2. No Shared Mutable State**
- All state is in the database, not in memory.
- Each task reads its router record at the start of each step.
- Tasks update only their own row.
- Example:
  ```python
  # Task 1
  router1 = get_router("router1")  # Reads from DB
  # ... does stuff ...
  update_router_state("router1", "API_OK")  # Writes to DB

  # Task 2 (simultaneous)
  router2 = get_router("router2")  # Reads different row; no conflict
  # ... does stuff ...
  update_router_state("router2", "API_OK")  # Writes different row
  ```

**3. Python asyncio for Concurrency**
- Single event loop schedules all tasks.
- When a task calls `await` (e.g., `await validate_api_access()`), it yields CPU to other tasks.
- No threads needed; no GIL contention.
- Handles 50+ concurrent I/O operations easily.

**4. Database Atomicity**
SQLite/PostgreSQL ensure atomic updates:
```python
UPDATE routers SET state = 'API_OK' WHERE id = 'router1'
```
This is atomic; no race conditions between tasks.

### Example: Two Routers Onboarding in Parallel

**Timeline:**

```
Time  Task 1 (Router A)           Task 2 (Router B)          DB State
────  ────────────────────────    ─────────────────────      ──────────
 0:00 validate_api_access()       [waiting for Task 1]       A: NEW, B: NEW
      [I/O wait, yields CPU]
      
 0:01                             validate_api_access()      A: NEW, B: NEW
                                  [I/O wait, yields CPU]
                                  
 0:02 OK ✓                                                    A: API_OK, B: NEW
      create_wg_interface()
      [I/O wait, yields CPU]
      
 0:03                             OK ✓                        A: API_OK, B: API_OK
                                  create_wg_interface()
                                  [I/O wait, yields CPU]
                                  
 0:04 OK ✓                                                    A: WG_READY, B: API_OK
      get_wg_pubkey()
      [I/O wait, yields CPU]
      
 0:05                             OK ✓                        A: WG_READY, B: WG_READY
                                  get_wg_pubkey()
                                  [I/O wait, yields CPU]
                                  
 0:06 OK ✓                                                    A: WG_READY, B: WG_READY
      add_wg_peer()
      [I/O wait, yields CPU]
      
 0:07                             OK ✓                        A: WG_READY, B: WG_READY
                                  add_wg_peer()
                                  [I/O wait, yields CPU]
                                  
 0:08 OK ✓                                                    A: TUNNEL_UP, B: WG_READY
      wait_tunnel_handshake()
      [Poll loop, every 2 sec]
      
 0:09                             OK ✓                        A: TUNNEL_UP, B: TUNNEL_UP
                                  wait_tunnel_handshake()
                                  [Poll loop, every 2 sec]
                                  
... (tunnel polls) ...
      
 2:00 Tunnel OK ✓                                            A: TUNNEL_UP, B: TUNNEL_UP
      disable_api_on_lan()
      rotate_admin_password()
      [I/O wait, yields CPU]
      
 2:02                             Tunnel OK ✓               A: DONE, B: TUNNEL_UP
                                  disable_api_on_lan()
                                  rotate_admin_password()
                                  [I/O wait, yields CPU]
                                  
 2:04 DONE ✓                                                A: DONE, B: DONE
      
 2:06                             DONE ✓
```

**Key observations:**
- Both tasks progress independently.
- When one task yields on I/O (`await`), the other task runs.
- No locks; no blocked waiting.
- DB atomicity prevents race conditions.
- One failure (e.g., Router B's API unreachable) does not affect Router A.

---

## Idempotency Pattern

Each RouterOS API wrapper is idempotent:

```python
async def create_wg_mgmt_interface(ip, user, pass):
    # Check if exists
    result = await api_query(".../wireguard/print")
    if result:
        return True  # Already exists; idempotent success
    
    # Create it
    await api_add(".../wireguard", params)
    return True
```

**Safe to call multiple times:**
- First call: creates interface.
- Second call: interface already exists; function returns True (no error).
- Third call: same as second.

This means **onboarding is restartable**:
- If a task crashes mid-step, restart it; it will resume from the same state.
- If a step fails and is manually retried, it's safe (idempotent).

---

## Handling Failures

**Scenario: Router A fails at `disable_api_on_lan()`**

```
Task 1 (Router A):
  state = API_OK → WG_READY → TUNNEL_UP → [disable_api_on_lan fails]
  → set state to ERROR
  → log error message
  → task ends

Task 2–N (Routers B–N):
  continue normally; not affected by A's failure
```

Router A's failure is isolated:
- Task 1 updates only Router A's row.
- Other tasks continue independently.
- UI polls `/routers/router_a/status` and sees `state=ERROR, error="Failed to disable API..."`
- User can retry via `POST /routers/router_a/retry` (idempotent, safe to call again).

---

## Scaling Considerations

### 10–50 Routers (Recommended)

**Python asyncio can handle this easily.**

- 50 concurrent `await` calls: no problem.
- Event loop scheduling is efficient for I/O-bound tasks.
- Memory: ~1 MB per task, so 50 tasks ≈ 50 MB.

### 100+ Routers (If Needed)

**Options:**
1. **Process Pool** — Spawn multiple Python processes, each with its own event loop:
   ```python
   from concurrent.futures import ProcessPoolExecutor
   executor = ProcessPoolExecutor(max_workers=4)
   ```
   Each process handles 25–50 routers independently.

2. **Separate Instances** — Deploy backend on multiple servers; each instance handles a subset of routers.

3. **Message Queue** — Use Redis + Celery for task distribution (but adds complexity; avoid if ≤50 routers).

**For MVP: single-instance asyncio is sufficient.**

---

## Race Condition Proofs

### Scenario 1: Two Tasks Update Same Router

```
Task 1: UPDATE routers SET state='API_OK' WHERE id='router1'
Task 2: UPDATE routers SET state='API_OK' WHERE id='router1'  [simultaneous]
```

**Result:** Both updates succeed (SQLite/PostgreSQL handle concurrent writes atomically). Final state is `API_OK` (idempotent).

---

### Scenario 2: Task Reads Stale State

```
Task 1 (t=0): router = get_router('router1')  [state = NEW]
Task 2 (t=0): router = get_router('router1')  [state = NEW]
Task 1 (t=1): validate_api_access() → OK
Task 1 (t=2): update_router_state('router1', 'API_OK')
Task 2 (t=3): validate_api_access() → OK  [redundant, but safe]
Task 2 (t=4): update_router_state('router1', 'API_OK')  [same state, no harm]
```

**Result:** Both tasks idempotently try the same step; final state is correct.

---

### Scenario 3: Concurrent Router Creation

```
POST /routers/onboard {ip: '192.168.1.1', ...}  [Request A]
POST /routers/onboard {ip: '192.168.1.2', ...}  [Request B, simultaneous]

Main Task (FastAPI):
  Request A: router_id = 'uuid_A'
    create_router('uuid_A', ip='192.168.1.1')  [INSERT]
    spawn_onboarding_task('uuid_A')
    return
    
  Request B: router_id = 'uuid_B'
    create_router('uuid_B', ip='192.168.1.2')  [INSERT]
    spawn_onboarding_task('uuid_B')
    return
```

**Result:** Both inserts succeed (different rows). FastAPI is single-threaded, so request handling is sequential (but fast enough; JSON parsing << network I/O time).

---

## Database Choice: SQLite vs PostgreSQL

| Aspect | SQLite | PostgreSQL |
|--------|--------|------------|
| **Concurrency** | Good for asyncio + SQLite (WAL mode) | Better for multiple processes |
| **Durability** | File-based; safe on single machine | Network-safe; handles replicas |
| **Setup** | None; file-based | Requires server |
| **For MVP** | ✓ Recommended | Overkill |
| **For Production** | Consider WAL mode; ok up to ~100 concurrent | Recommended |

**For this MVP: use SQLite with WAL mode enabled:**
```sql
PRAGMA journal_mode = WAL;
```

This allows concurrent reads + writes without locking.

---

## Testing Concurrency

```bash
# Test 5 routers in parallel
for i in {1..5}; do
  curl -X POST http://localhost:8000/routers/onboard \
    -H "Content-Type: application/json" \
    -d "{\"ip\": \"192.168.1.$i\", \"username\": \"admin\", \"password\": \"test\"}" &
done
wait

# Check status
for i in {1..5}; do
  curl http://localhost:8000/routers/*/status | jq .
done
```

**Expected:** 5 routers onboarding simultaneously; each progresses independently.

---

## Summary

- **Task-per-router** + **database as coordinator** = no locks, no shared state.
- **Python asyncio** = efficient concurrent I/O.
- **Idempotent steps** = safe to restart/retry.
- **Atomic DB updates** = no race conditions.
- **Failure isolation** = one router's error doesn't block others.
- **Scale:** 10–50 routers easily; 100+ needs process pooling.

**Result: Scalable, correct, production-ready concurrent onboarding.**
