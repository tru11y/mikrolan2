# MikroLan – Codex Project Guide

## Project Overview

**MikroLan** is a production-ready backend for onboarding multiple MikroTik routers in parallel, with safe concurrency, idempotent operations, and isolated failure handling.

- **Tech Stack:** Python 3.9+, FastAPI, SQLite, asyncio
- **Architecture:** Single FastAPI instance, lock-free state machine per router, database-as-coordinator
- **Key Design:** Minimal dependencies (no K8s, Redis, Celery); async I/O; idempotent operations; failure isolation

## Repository Structure

```
.
├── ARCHITECTURE.md           # High-level design & DB schema
├── CONCURRENCY.md            # Detailed async design & proofs
├── DEPLOYMENT.md             # Docker, systemd, troubleshooting
├── IMPLEMENTATION_CHECKLIST.md
├── MOBILE_APP_SPEC_V1.md     # Mobile app integration spec
├── V1_PRODUCT_VALIDATION.md  # Feature validation
├── models.py                 # Database models & ORM
├── routeros_api.py           # Idempotent RouterOS API wrappers
├── onboarding.py             # Core state machine
├── main.py                   # FastAPI app (3 endpoints)
├── requirements.txt          # Dependencies
├── mikroserver/              # Backend submodule (git@github.com:tru11y/mikroserver.git)
└── mikrolan-mobile/          # Mobile app submodule (local)
```

## Key Files to Understand

1. **CONCURRENCY.md** ← Start here to understand async design
2. **ARCHITECTURE.md** ← DB schema, state machine flow
3. **main.py** → FastAPI endpoints & async handlers
4. **onboarding.py** → State machine logic
5. **routeros_api.py** → RouterOS API calls (check-then-create pattern)

## API Endpoints

- `POST /routers/onboard` → Trigger onboarding (async, returns immediately)
- `GET /routers/{router_id}/status` → Check progress & logs
- `POST /routers/{router_id}/retry` → Retry failed onboarding (idempotent)

## Concurrency Model

- **No global locks** — each router updates only its own DB row
- **asyncio single event loop** — efficient I/O scheduling for 10–50 concurrent routers
- **All state persisted** — database acts as coordinator; safe to restart
- **Idempotent operations** — every step uses check-then-create pattern

## State Machine

```
NEW → API_OK → WG_READY → TUNNEL_UP → LOCKED → DONE
     (or ERROR at any step; can retry)
```

See `onboarding.py` for implementation.

## Environment

- **Working Directory:** `c:\Users\PC\OneDrive - Epitech\amy\PROJETS-TERMINES\mikrolan`
- **GitHub Remote:** `git@github.com:tru11y/mikroserver.git`
- **User Email:** b2.bamba2@gmail.com

## Development Notes

- Use `CONCURRENCY.md` as reference for async safety questions
- All RouterOS operations must be idempotent (check-then-create)
- Database queries replace Redis/queues — keep it simple
- Failure handling is per-router; one failure doesn't cascade

## Common Tasks

- **Add new endpoint** → Update `main.py`, document in ARCHITECTURE.md
- **Add new state** → Update state machine in `onboarding.py`, migration plan
- **Debug concurrency** → Check SQLite transaction logs in CONCURRENCY.md
- **Deployment** → See DEPLOYMENT.md for Docker/systemd setup

## Next Steps for Production

- [ ] Add password encryption (Fernet)
- [ ] Add API authentication (OAuth2 / API keys)
- [ ] Switch to PostgreSQL if >100 concurrent routers
- [ ] Structured logging (JSON, syslog)
- [ ] Integration tests with real/mock routers
