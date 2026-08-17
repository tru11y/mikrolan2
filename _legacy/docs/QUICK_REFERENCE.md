# Quick Reference Guide

## File Structure

```
├── README.md                  # Start here; overview and motivation
├── ARCHITECTURE.md            # System design, state machine, DB schema
├── CONCURRENCY.md             # **Critical**: parallel execution explained
├── DEPLOYMENT.md              # Setup, Docker, systemd, monitoring
├── QUICK_REFERENCE.md         # This file
├── models.py                  # Database models (Router, RouterState)
├── routeros_api.py            # Idempotent RouterOS API wrappers
├── onboarding.py              # State machine (one function per router)
├── main.py                    # FastAPI application
├── example_client.py          # Usage examples
└── requirements.txt           # Python dependencies
```

## How It Works in 30 Seconds

1. **Mobile app** sends `POST /routers/onboard {ip, user, pass}`
2. **FastAPI** creates DB record, spawns async task, returns immediately
3. **Background task** (`onboarding_worker`) runs state machine:
   - NEW → API_OK → WG_READY → TUNNEL_UP → LOCKED → DONE
   - Each step is idempotent (safe to retry)
4. **Mobile app** polls `GET /routers/{id}/status` to see progress
5. **If failure** → state = ERROR; user can retry via `POST /routers/{id}/retry`

**Concurrency:** 50 tasks run via Python asyncio (one event loop). No locks. Each router's state is isolated in DB.

## API Endpoints

```bash
# Onboard a router
POST /routers/onboard
{
  "ip": "192.168.1.1",
  "username": "admin",
  "password": "default",
  "wg_peer_ip": "10.0.0.2"
}

# Check status
GET /routers/{router_id}/status

# Retry if failed
POST /routers/{router_id}/retry

# Health check
GET /health
```

## Running Locally

```bash
# 1. Install
pip install -r requirements.txt

# 2. Set env vars (or .env file)
export BACKEND_WG_PUBKEY="your_backend_wireguard_pubkey"

# 3. Run
python main.py

# 4. In another terminal, run example client
python example_client.py
```

## Database (SQLite)

```sql
-- View all routers
sqlite3 routers.db "SELECT id, ip, state, error FROM routers;"

-- View logs for a router
sqlite3 routers.db "SELECT step, status, message, created_at FROM onboarding_logs WHERE router_id='...';"

-- Reset a router (clear and allow re-onboarding)
sqlite3 routers.db "DELETE FROM routers WHERE id='...'; DELETE FROM onboarding_logs WHERE router_id='...';"
```

## Key Concepts

### State Machine (Per Router)

```
NEW
  ↓ validate_api_access()
API_OK
  ↓ create_wg_mgmt_interface()
WG_READY
  ↓ add_wg_peer() + assign_wg_ip()
TUNNEL_UP
  ↓ wait_tunnel_handshake()
LOCKED
  ↓ disable_api_on_lan() + rotate_admin_password()
DONE

ERROR ← any step fails
```

### Concurrency Guarantees

| Guarantee | How |
|-----------|-----|
| No locks | Each router updates only its own DB row |
| No shared state | State is in database, not memory |
| Safe to retry | All steps check-then-create (idempotent) |
| Failure isolated | One router's error doesn't affect others |

### Idempotency Pattern

```python
# All RouterOS operations follow this pattern:

async def create_wg_mgmt_interface(...):
    # 1. Check if done
    result = await api_query(".../wireguard/print")
    if result:
        return True  # Already done; safe to return success
    
    # 2. If not, do it
    await api_add(".../wireguard", ...)
    return True
```

This means you can call the same operation multiple times with the same inputs, and it's safe.

## Debugging

### Router stuck in state X

```bash
# Check logs
sqlite3 routers.db "SELECT step, status, message FROM onboarding_logs WHERE router_id='...' ORDER BY created_at DESC LIMIT 10;"

# Check error message
sqlite3 routers.db "SELECT error FROM routers WHERE id='...';"
```

### Backend not responding

```bash
# Check if running
curl http://localhost:8000/health

# Check logs (if running in foreground)
# Press Ctrl+C and check error messages
```

### Router API unreachable

```bash
# Test manually
python3 -c "from librouteros_async import ConnectionPoolAsync; conn = ConnectionPoolAsync(ip='192.168.1.1', username='admin', password='default'); print('OK')"
```

### WireGuard tunnel not coming up

```bash
# On router, check if interface exists
ssh admin@192.168.1.1 "/interface/wireguard/print"

# On backend, check if peer was added
ssh admin@192.168.1.1 "/interface/wireguard/peers/print"

# Check tunnel endpoint
ssh admin@192.168.1.1 "/interface/wireguard/print detail=yes" | grep "last-endpoint"
```

## Common Tasks

### Onboard 5 routers (script)

```bash
#!/bin/bash
for i in {1..5}; do
  curl -X POST http://localhost:8000/routers/onboard \
    -H "Content-Type: application/json" \
    -d "{\"ip\": \"192.168.1.$i\", \"username\": \"admin\", \"password\": \"default\"}" &
done
wait
echo "All requests sent; check status with: sqlite3 routers.db \"SELECT ip, state FROM routers;\""
```

### Monitor onboarding in real-time

```bash
watch -n 1 'sqlite3 routers.db "SELECT ip, state, COUNT(*) FROM routers GROUP BY ip, state ORDER BY ip;"'
```

### Clean up old routers

```bash
# Delete routers older than 7 days
sqlite3 routers.db "DELETE FROM routers WHERE created_at < datetime('now', '-7 days'); DELETE FROM onboarding_logs WHERE created_at < datetime('now', '-7 days');"
```

### Export status as JSON

```bash
#!/bin/bash
curl http://localhost:8000/routers/{router_id}/status | jq . > router_status.json
```

## Performance Notes

| Metric | Value |
|--------|-------|
| Time to onboard 1 router | 30–120 seconds (mostly tunnel handshake) |
| Time to onboard 50 routers in parallel | ~120 seconds (not 50× single time) |
| Memory per concurrent task | ~1 MB |
| Database size per router | ~1 KB |
| Max concurrent routers (single instance) | 10–50 recommended; 100+ needs pooling |

## Scaling

- **10–50 routers:** Current design (single instance, asyncio) ✓
- **50–200 routers:** Add process pooling (multiple Python processes)
- **200+ routers:** Add distributed queue (Redis + Celery) or multiple backend instances

Current design is a solid foundation; don't overcomplicate until needed.

## Security Checklist

- [ ] Encrypt credentials in database (use `cryptography.fernet`)
- [ ] Add authentication to API endpoints (API key or OAuth2)
- [ ] Use HTTPS in production (reverse proxy with cert)
- [ ] Rotate WireGuard keys periodically
- [ ] Monitor for failed provisioning attempts
- [ ] Keep RouterOS API password out of logs
- [ ] Store `.env` file in `.gitignore`
- [ ] Use environment variables for secrets (never hardcode)

## Testing Checklist

- [ ] Single router onboarding (happy path)
- [ ] Parallel onboarding (5–10 routers)
- [ ] Retry after failure
- [ ] Database persistence (kill server, restart, check progress)
- [ ] Idempotency (call same step twice, verify no errors)
- [ ] Failure isolation (one router fails, others continue)
- [ ] API error handling (bad credentials, unreachable router)

## Production Checklist

- [ ] Set `BACKEND_WG_PUBKEY` environment variable
- [ ] Set `ENCRYPTION_KEY` for credential storage
- [ ] Set `DB_PATH` to persistent location
- [ ] Configure systemd service or Docker
- [ ] Set up log rotation (if using file-based logs)
- [ ] Set up monitoring/alerting (optional; DB queries work fine)
- [ ] Test graceful shutdown (cleanup tasks on SIGTERM)
- [ ] Backup database periodically

## Further Reading

1. **`CONCURRENCY.md`** — Understand parallel execution, race conditions, scaling
2. **`ARCHITECTURE.md`** — Understand state machine, DB schema, design decisions
3. **`DEPLOYMENT.md`** — Setup, Docker, systemd, troubleshooting
4. **`example_client.py`** — See API usage in action

---

**TL;DR:** One task per router, database coordinates, all idempotent, no locks. Done.
