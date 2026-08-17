# MikroLan V1 Backend Architecture

## Executive Summary
MikroLan is a multi-tenant SaaS backend for ISP operators to provision and manage MikroTik routers at scale. The backend is operator-driven via REST API (consumed by a native Android app), event-sourced for auditability, and designed for safety-first operations with explicit verification before state changes.

---

## 1. BACKEND RESPONSIBILITIES

### Core Domains
The backend owns:

| Domain | Responsibility | Boundary |
|--------|-----------------|----------|
| **Tenant Management** | Account creation, subscription tiers, isolation, operator credentials | Multi-tenancy enforcement; NOT payment processing |
| **Router Registry** | Device inventory, health tracking, connection state | Device discovery API; NOT physical deployment |
| **Job Orchestration** | Plan, apply, verify, rollback workflows for config changes | Job execution; NOT device firmware updates |
| **WireGuard PKI** | Key generation, peer allocation, certificate lifecycle | Crypto; NOT VPN user management |
| **Audit Trail** | Complete event log for compliance (who, what, when, why) | Event storage; NOT forensics analysis |
| **API Gateway** | Versioning, authentication, rate limiting, request validation | API contract; NOT client-side UI |

### What the Backend Does NOT Do
- **Payment processing** — ops staff handle billing externally
- **Physical device deployment** — field technicians handle hardware
- **Router firmware updates** — must be done manually by ops staff
- **VPN user/peer creation** — WireGuard peers are tied to router configs, not separate users
- **Email/SMS notifications** — external integrations only
- **Real-time streaming** — polling model only (long-poll optional in V2)
- **Device SSH tunneling** — device reaches API, not reverse

---

## 2. DATA MODEL

### Core Entities

#### Tenant
```
Tenant
├── id (UUID)
├── name (string)
├── tier (free|pro|enterprise)
├── status (active|suspended|deleted)
├── created_at
└── metadata (custom_domain, branding, etc.)
```

Isolation: Row-level security on all tables via `tenant_id` foreign key. Queries always filter by authenticated tenant.

---

#### Router
```
Router
├── id (UUID)
├── tenant_id (FK)
├── identity (string, unique per tenant)    # e.g., "ISP-REGION-001"
├── address (string)                         # IP:port to reach device
├── api_token (encrypted string)             # MikroTik API credentials
├── wg_interface (string)                    # e.g., "wg0"
├── model (string)                           # "RB3011", "RB4011", etc.
├── firmware_version (string)
├── status (online|offline|error)
├── last_heartbeat (timestamp)
├── config_version (int)                     # Current applied config version
├── tags (array)                             # e.g., ["region:us-west", "tier:premium"]
├── created_at
└── deleted_at (soft delete)
```

**Constraints:**
- `(tenant_id, identity)` is unique
- Indexes on `tenant_id`, `status`, `last_heartbeat`

---

#### Router Config (immutable versioned snapshots)
```
RouterConfig
├── id (UUID)
├── router_id (FK)
├── tenant_id (FK)
├── version (int, auto-increment per router)
├── state (draft|applied|failed|rolled_back)
├── config_data (JSON)                       # The actual config (below)
├── created_by (user_id)
├── created_at
├── applied_at (nullable)
└── notes (string)                           # Why this config exists
```

**Config Data Structure:**
```json
{
  "wg_peers": [
    {
      "public_key": "...",
      "endpoint": "optional, static routing",
      "allowed_ips": ["10.0.1.0/24"],
      "persistent_keepalive": 25
    }
  ],
  "firewall_rules": [
    {
      "chain": "forward|input|output",
      "action": "accept|drop|reject",
      "protocol": "tcp|udp|...",
      "port": "...",
      "comment": "..."
    }
  ],
  "ip_address": [
    {
      "address": "192.168.1.1/24",
      "interface": "ether1"
    }
  ],
  "dns": {
    "allow_remote_requests": true,
    "servers": ["8.8.8.8", "1.1.1.1"]
  }
}
```

---

#### Job (execution unit for state transitions)
```
Job
├── id (UUID)
├── tenant_id (FK)
├── router_id (FK)
├── router_config_id (FK)                    # Which config to apply
├── type (apply|verify|rollback)
├── status (pending|running|success|failed)
├── phase (planning|applying|verifying|rolling_back|complete)
├── result (JSON, output of operation)
├── created_by (user_id)
├── created_at
├── started_at (nullable)
├── completed_at (nullable)
└── error_details (nullable)
```

---

#### WireGuard Peer
```
WireGuardPeer
├── id (UUID)
├── tenant_id (FK)
├── router_id (FK)
├── public_key (string, unique per tenant)
├── private_key (encrypted, backend-generated)
├── endpoint (string, optional, can be dynamic)
├── allowed_ips (array)
├── status (active|disabled|expired)
├── assigned_to (description, e.g., "Remote office in Denver")
├── created_at
├── expires_at (optional, for rotating certs)
└── last_rotation (timestamp)
```

**Key Insight:** Peers are router-scoped, not user-scoped. Backend generates all keys; devices never see private keys.

---

#### Audit Event
```
AuditEvent
├── id (UUID)
├── tenant_id (FK)
├── actor (user_id|service)
├── resource_type (router|config|job|peer)
├── resource_id (UUID)
├── action (create|update|delete|apply|verify|rollback)
├── before_state (JSON, nullable)
├── after_state (JSON, nullable)
├── reason (string)                          # Why was this done?
├── created_at
└── metadata (JSON, extra context)
```

All state mutations create an audit event. Immutable append-only log. Indexes on `tenant_id`, `resource_type`, `created_at`.

---

#### API Token (for mobile app authentication)
```
APIToken
├── id (UUID)
├── tenant_id (FK)
├── token_hash (bcrypt)
├── name (string, e.g., "Android App - Production")
├── scopes (array, e.g., ["router:read", "job:write"])
├── last_used_at (nullable)
├── expires_at (nullable)
├── created_at
└── revoked_at (nullable)
```

Tokens are long-lived. Rotation via new token + revoke old. No token auth in V1 beta; assume native app has hardcoded backend URL + operator manually manages one credentials file.

---

## 3. JOB EXECUTION MODEL

### State Machine: Apply Workflow

```
┌─────────────────────────────────────────────────────────┐
│ Operator creates RouterConfig (draft)                   │
│ - No automation, purely human decision                  │
│ - Config stored as immutable version                    │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
          ┌──────────────────────┐
          │ Create Apply Job     │
          │ (pending)            │
          └──────────┬───────────┘
                     │
        ┌────────────┴────────────┐
        │ Operator reviews diff   │
        │ (UI shows before/after) │
        └────────────┬────────────┘
                     │
                     ▼
    ┌────────────────────────────────────────┐
    │ Operator clicks "APPLY" (explicit OK)  │
    │ Job transitions to "running/applying"  │
    └────────────┬─────────────────────────┘
                 │
                 ▼
        ┌──────────────────────────────────┐
        │ Backend connects to Router via    │
        │ MikroTik API (router_id + token)  │
        └────────────┬─────────────────────┘
                     │
        ┌────────────┴─────────────┐
        │ Read current state       │
        │ (snapshot before)        │
        │ Capture to audit trail   │
        └────────────┬────────────┘
                     │
                     ▼
    ┌────────────────────────────────────────────────┐
    │ Construct diff (desired - current)             │
    │ Execute plan (dry-run if possible, or minimal) │
    └────────────┬─────────────────────────────────┘
                 │
                 ▼
      ┌─────────────────────────────────┐
      │ Apply changes to device         │
      │ - WireGuard peer adds           │
      │ - Firewall rule changes         │
      │ - DNS/IP config                 │
      │ - Preserve service state        │
      └─────────────┬───────────────────┘
                    │
                    ▼
     ┌──────────────────────────────────┐
     │ Job transitions to "verifying"   │
     │ Wait 5s for device to settle     │
     └─────────────┬────────────────────┘
                   │
                   ▼
   ┌────────────────────────────────────┐
   │ VERIFY PHASE: Read device state    │
   │ Compare against desired config      │
   │ Check for convergence               │
   │ (WG peers exist, rules match, etc.) │
   └────────────┬───────────────────────┘
                │
       ┌────────┴────────┐
       │                 │
       ▼                 ▼
   MATCH            MISMATCH
   │                │
   ▼                ▼
SUCCESS         ROLLBACK
(completed)     (failed job)
   │                │
   ▼                ▼
Mark config    (Operator manually
applied       reviews + decides
              next step)
```

### Job Types

**Apply Job**
- **Trigger:** Operator selects a config and clicks "Apply"
- **Pre-check:** Compare draft config to current device state, show diff
- **Execution:** Connect to device, push changes via MikroTik API
- **Verify:** Read device state back, compare to desired
- **Result:** Success (config_version++, mark applied) or Failed (audit trail + rollback instructions)

**Verify Job**
- **Trigger:** Manual, on-demand by operator (health check)
- **Execution:** Read device state, compare to last applied config
- **Result:** Reports drift (if any) without changing device
- **Non-blocking:** Can run while Apply jobs are in progress

**Rollback Job**
- **Trigger:** Operator explicitly decides to revert to a prior config
- **Execution:** Mark target config as "desired", run Apply job
- **Verify:** Same verification as Apply

### Rollback Safety

**Key Principle:** Rollback is NOT automatic. Always manual and explicit.

1. Operator reviews audit trail to see which config was working
2. Operator selects that config and clicks "Rollback to version N"
3. Backend treats this as a new Apply job with an older config
4. Full verification cycle runs
5. If new Apply job fails, operator can try a different old version

**Why No Auto-Rollback:**
- Network changes can cascade (e.g., firewall rule breaks peer discovery)
- ISP field ops need to understand what changed before reverting
- Auto-rollback can hide the root cause and make debugging harder

---

## 4. WIREGUARD PROVISIONING MODEL

### Peer Lifecycle

```
┌────────────────────────────────────────────────┐
│ Operator decides to add a WireGuard peer       │
│ (e.g., new remote office, customer site)      │
└────────────┬─────────────────────────────────┘
             │
             ▼
  ┌────────────────────────────────┐
  │ Backend generates key pair     │
  │ - Private key (stored encrypted) │
  │ - Public key (to device)         │
  │ Create WireGuardPeer record      │
  └────────┬───────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────┐
  │ Operator assigns to endpoint:          │
  │ "Remote office Denver"                 │
  │ (optional static IP for routing)       │
  └────────┬───────────────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────┐
  │ Operator creates/updates RouterConfig  │
  │ with new peer's public key             │
  │ + allowed_ips for that site            │
  └────────┬───────────────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────┐
  │ Operator applies config (Apply job)    │
  │ - MikroTik device adds WG peer         │
  │ - Firewall rules permit traffic        │
  └────────┬───────────────────────────────┘
           │
           ▼
  ┌────────────────────────────────────────┐
  │ Backend provides WG config to app:     │
  │ (Operator downloads via secure link)   │
  │ [Interface]                            │
  │ PrivateKey = <encrypted>               │
  │ Address = 10.0.1.5/24                  │
  │ [Peer]                                 │
  │ PublicKey = <router's key>             │
  │ Endpoint = <router IP>:51820           │
  │ AllowedIPs = 10.0.0.0/16               │
  └────────────────────────────────────────┘
```

### Multi-Device WireGuard Mesh (Optional Future)

For V1, WireGuard is **single router → multiple remote sites** (star topology).

If V2 adds mesh (router ↔ router WireGuard), the model extends:
- Each router gets its own keypair in the tenant's PKI
- Peers between routers are managed like any other peer
- Backend orchestrates mesh topology via job system

---

## 5. API PRINCIPLES

### Versioning Strategy

**URL Versioning (explicit, stable)**
```
GET /api/v1/routers              # Stable v1 contract
GET /api/v2/routers              # New contract, breaking changes OK
```

**V1 Stability Guarantee:**
- All endpoints under `/api/v1/*` are frozen for 2 years
- Breaking changes only in new major version
- Deprecation warnings in headers (X-Sunset-Date) for 6 months before removal

**Adding Fields:**
- New optional fields in responses are always safe
- Old clients ignore them
- New required fields → new version

---

### Authentication & Authz

**V1 Mechanism:**
```
Authorization: Bearer <operator_api_token>
```

**Scopes (future, but design for it now):**
```
router:read          # View router inventory
router:write         # Create/update routers
config:read          # View configs
config:write         # Create/draft configs
job:read             # View job history
job:write            # Trigger apply/verify jobs
peer:read            # View WG peers
peer:write           # Create/update peers
audit:read           # View audit logs
```

**Tenant Isolation:**
- All requests filtered by authenticated tenant_id
- No cross-tenant API access
- No admin "superuser" mode in V1 (keep simple)

---

### Request/Response Contract

**Standard Success Response:**
```json
{
  "status": "success",
  "data": { /* resource */ },
  "meta": {
    "version": "v1",
    "timestamp": "2026-05-05T10:30:00Z"
  }
}
```

**Standard Error Response:**
```json
{
  "status": "error",
  "error": {
    "code": "ROUTER_OFFLINE",
    "message": "Router ISP-US-WEST-001 is currently offline",
    "details": {
      "router_id": "...",
      "last_heartbeat": "2026-05-05T09:00:00Z"
    }
  },
  "meta": {
    "version": "v1",
    "timestamp": "2026-05-05T10:30:00Z"
  }
}
```

**HTTP Status Codes:**
```
200 OK             Successful GET, completed job
201 Created        New resource
202 Accepted       Job submitted (job is pending/running)
400 Bad Request    Invalid input
401 Unauthorized   Missing/invalid token
403 Forbidden      Valid token, insufficient permissions
404 Not Found      Resource doesn't exist
409 Conflict       State conflict (e.g., job already running)
429 Too Many Requests (V2)
500 Internal Error Non-recoverable issue
```

---

### Idempotency

**Safe Endpoints (idempotent):**
```
GET /api/v1/routers
GET /api/v1/routers/:id
POST /api/v1/routers/:id/verify-job (multiple calls = multiple verify jobs, which is OK)
```

**Unsafe Endpoints (non-idempotent, use Idempotency-Key in V2):**
```
POST /api/v1/routers/:id/apply-job
  (Creating the same Apply job twice = two separate job executions)

POST /api/v1/routers/:id/config
  (Posting the same config twice = version 2, version 3)
```

**V1 Guidance for Client:**
- App must guard against double-submission (loading spinner until job completes)
- V2 will add Idempotency-Key header for automatic deduplication

---

### Rate Limiting (V2+)

**Proposed tiers:**
- Free: 100 requests/hour, 5 concurrent routers
- Pro: 10K requests/hour, 50 concurrent routers
- Enterprise: Custom

---

## 6. OPERATIONAL FLOWS

### Provisioning a New Router

```
1. ISP ops staff prepare hardware
   - Deploy RB3011 to site
   - Configure initial IP (WAN + management LAN)
   - Set MikroTik API user + password

2. Operator creates Router in app
   POST /api/v1/routers
   {
     "identity": "ISP-REGION-001",
     "address": "203.0.113.45:8728",
     "api_token": "<encrypted MikroTik creds>",
     "wg_interface": "wg0",
     "model": "RB3011"
   }

3. Backend immediately tests connectivity
   (health check on create)

4. If online:
   - Audit event: "Router registered"
   - Status = "online"
   - Ready for config

5. Operator creates first RouterConfig
   (draft, not applied)

6. Operator applies config
   - Apply job created
   - Backend connects, pushes config
   - Verify phase checks convergence
   - Audit: "Config applied to ISP-REGION-001"

7. Device now running provisioned config
```

---

### Scaling to 1000 Routers

**Challenges:**
- Job queuing (can't connect to all 1000 in parallel)
- Health check frequency (heartbeat storms)
- Network latency (MikroTik API can be slow)

**Solutions (V1):**
1. **Job Queue with Worker Pool**
   - DB-backed queue (Redis optional in V2)
   - 5-10 concurrent workers
   - Priority: health checks > verifies > applies
   - FIFO within priority

2. **Staggered Health Checks**
   - Check each router once per hour, staggered
   - Alert if offline for >5 minutes
   - Last heartbeat timestamp for drift detection

3. **API Timeouts**
   - MikroTik API: 30s timeout per request
   - If device slow, job fails explicitly (not silent timeout)
   - Operator must retry or troubleshoot

4. **Batch Operations (Future)**
   - Group N routers by tag, apply same config to all
   - Single Apply job with multiple executions
   - Parallel within rate limits

---

## 7. NON-GOALS

### Explicitly OUT of Scope for V1

- **Firmware updates** — Manual for now. Field tech SSHes to device.
- **User management** — Only operator credentials for entire tenant.
- **Email notifications** — No automated alerts yet.
- **Real-time streaming** — Polling only (websockets in V2).
- **VPN peer creation** — WireGuard peers are generated by backend, fixed to router configs.
- **Cost tracking** — No billing integration (payment handled externally).
- **Multi-region** — Single SaaS instance. Geo-distribution in V2.
- **Device grouping policies** — Tags are free-form for now, no templating.
- **Config templating** — Configs are per-router, no inheritance yet.
- **Automated recovery** — All recovery is manual (safer for critical infra).
- **SSH tunneling** — Backend never initiates outbound connections. Device calls API.
- **TLS client certs** — API tokens only. PKI for WireGuard, not for API.

---

## 8. DEPLOYMENT ARCHITECTURE

### Minimum Viable Deployment

```
┌─────────────────────────────────┐
│ Single VPS (4 CPU, 8GB RAM)     │
├─────────────────────────────────┤
│ PostgreSQL 15                   │ ← Audit log (immutable)
│ (encrypted at-rest)             │   + Router registry
│ (nightly snapshots)             │
│                                 │
│ Backend API (Python/Go/Node)    │ ← Stateless, 2-3 replicas
│ (via systemd/docker)            │
│                                 │
│ Job Queue Worker (1-2 processes)│ ← Connects to routers
│ (async, consumes DB queue)      │   (MikroTik API calls)
│                                 │
│ Nginx reverse proxy             │ ← TLS termination
│                                 │   Rate limiting (basic)
└─────────────────────────────────┘
```

### Secrets Management

**Stored (encrypted-at-rest in DB):**
- MikroTik API tokens per router
- WireGuard private keys
- API tokens for operators

**Encryption:**
- AES-256-GCM per row
- Master key from environment (AWS Secrets Manager / HashiCorp Vault in production)
- Rotate annually

**Audit Trail:**
- All decryption logged
- Who decrypted what, when

---

## 9. SECURITY CHECKLIST

- [ ] All mutations produce audit events
- [ ] API tokens are hashed (bcrypt) before storage
- [ ] Row-level security enforced via tenant_id
- [ ] MikroTik API credentials encrypted at rest
- [ ] WireGuard private keys never transmitted to device
- [ ] Rate limiting on API endpoints
- [ ] HTTPS only (no HTTP)
- [ ] CSRF protection for state-changing operations
- [ ] SQL injection prevention (parameterized queries)
- [ ] Request validation (schema, size limits)
- [ ] Timeout on all external calls (MikroTik API)
- [ ] Audit trail cannot be deleted (append-only)
- [ ] No plaintext logs of credentials
- [ ] Job execution is idempotent (safe to retry)

---

## 10. MIGRATION PATH: V1 → V2

**V2 Planned (not committed):**
- [ ] Batch operations (apply one config to multiple routers)
- [ ] Config templating with variables
- [ ] Role-based access control (not just operator-level)
- [ ] Real-time job status streaming (websockets)
- [ ] Auto-rollback after verification failure
- [ ] Config diff visualization (web UI)
- [ ] Email alerts on job failures
- [ ] Geo-distributed job execution
- [ ] In-app telemetry (device CPU, RAM, traffic)
- [ ] Advanced routing policies
- [ ] Multi-protocol support (beyond WireGuard)

**Backwards Compatibility:**
- V2 API endpoints coexist with V1 (no breaking changes to /api/v1/*)
- V2 adds /api/v2/* only
- Database schema is additive (new tables, not dropped columns)
- Job queue remains compatible (metadata versioned)

---

## Conclusion

MikroLan V1 is a **clean, audit-first backend** optimized for safety and operator control. Every state change is logged, every deploy is explicit, and rollbacks are always manual. This is intentional: ISP infrastructure is critical, and automation with safety valves beats smart automation with gotchas.

The architecture scales to 1000+ routers on a single VPS with a job queue, and the API is versioned for stability. Future versions will add sophistication (templating, roles, streaming), but the core model—explicit jobs, verifiable state, complete audit trails—remains unchanged.
