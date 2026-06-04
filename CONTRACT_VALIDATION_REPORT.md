# MikroLan V1 — Backend ↔ Mobile App Contract Validation
**Date**: 2026-05-05  
**Status**: CRITICAL MISMATCH DETECTED  
**Severity**: High — App design and backend design are not aligned

---

## EXECUTIVE SUMMARY

The **backend design** specifies a mobile operator app for **field technicians** (read-heavy, high-confidence remote control of provisioning jobs). The **current mobile implementation** is an **admin/SaaS dashboard** for resellers and internal staff (revenue, users, vouchers, routers). These are **two different products**.

**Result**: The mobile app does NOT implement the contract specified in `MOBILE_APP_SPEC_V1.md`. Integration will fail without major refactoring.

---

## 1. INTENDED vs. ACTUAL

### Backend Promises (MOBILE_APP_SPEC_V1.md)
- **Audience**: ISP field operators provisioning routers
- **Primary Use**: Monitor live provisioning jobs, intervene (pause/resume/retry/cancel), view router state
- **Scope**: Read-heavy, operator-driven control flows
- **Screens**: Dashboard, Jobs List, Job Detail, Routers, Router Detail, Quarantine, Settings
- **Actions**: Pause job, Resume job, Retry job, Cancel job, Release quarantine, Manual retry ping

### Current Mobile Implementation (api.ts, screens/)
- **Audience**: ISP resellers and internal admins
- **Primary Use**: Manage users, view revenue, generate vouchers, provision routers
- **Scope**: Admin dashboard with billing and operations
- **Screens**: Dashboard (KPIs), Plans, Users, Routers (inventory), Sessions, Vouchers, Transactions
- **Actions**: Create user, Suspend user, Generate voucher, Create router, Delete router

### Gap Assessment
| Capability | Backend Spec | Current App | Status |
|------------|-------------|------------|--------|
| Job monitoring (list) | ✓ Required | ✗ Missing | **CRITICAL** |
| Job detail with logs | ✓ Required | ✗ Missing | **CRITICAL** |
| Pause/resume/cancel job | ✓ Required | ✗ Missing | **CRITICAL** |
| Retry failed job | ✓ Required | ✗ Missing | **CRITICAL** |
| Quarantine management | ✓ Required | ✗ Missing | **CRITICAL** |
| Router roster view | ✓ Required | Partial | **MAJOR** |
| Router detail (identity, status, metrics) | ✓ Required | Partial | **MAJOR** |
| Confirmation dialogs on actions | ✓ Required | ✗ Missing | **MAJOR** |
| Offline-mode caching | ✓ Required | ✗ Missing | **MAJOR** |
| Auto-refresh (30s default) | ✓ Required | ✗ Missing | **MAJOR** |
| Role-based action hiding | ✓ Required | Partial | **MAJOR** |
| Backend connectivity indicator | ✓ Required | ✗ Missing | **MAJOR** |
| User/revenue management | ✗ Out of scope | ✓ Implemented | N/A |
| Voucher management | ✗ Out of scope | ✓ Implemented | N/A |

---

## 2. SCREEN-BY-SCREEN MAPPING

### Backend Spec: Login Screen
```
Purpose: Authenticate to a tenant
Inputs: Email, password
Outcome: Session token stored locally
```
**Current App**: ✓ Implemented  
**Endpoint**: `POST /auth/login`  
**Status**: MATCH ✓

---

### Backend Spec: Dashboard (Home)
```
Purpose: Snapshot of operational state
Displays:
  - Count of jobs by status (running, paused, failed, queued)
  - Count of routers by state (online, offline, quarantined)
  - Last sync timestamp
  - Red banner if backend unreachable
  - Recent critical events: last 3 job failures
Actions: Tap status count → Jobs/Routers screen
Refresh: Manual pull-to-refresh + auto-refresh every 30s
```
**Current App**: Partially implemented  
- ✓ Router status counts (online/offline)
- ✗ No job status counts
- ✗ No last sync timestamp
- ✗ No backend connectivity indicator
- ✗ No recent critical events
- ✗ No auto-refresh logic
- ✗ Manual refresh only (no pull-to-refresh)

**Endpoints**: `/metrics/dashboard` (exists but returns revenue KPIs, not job/router operational state)  
**Status**: MISMATCH ✗ — App returns wrong metrics

---

### Backend Spec: Jobs List Screen
```
Purpose: See all provisioning jobs, filtered by status
Default: Running and paused jobs
Filters: Running | Paused | Failed | Queued | Completed (24h)
Per job: ID, target router, status badge, progress, timestamp, ETA
Tap job → Job Detail
Long-press → Inline quick actions: Pause | Resume | Retry | Cancel
```
**Current App**: ✗ NOT IMPLEMENTED  
**Endpoints**: Missing all job-related endpoints  
**Status**: CRITICAL MISSING ✗

---

### Backend Spec: Job Detail Screen
```
Purpose: Full operational view of a single job
Displays:
  - Job ID, tenant, target router hostname/IP
  - Status with timestamp (started, paused, failed, completed)
  - Progress bar (if running or paused)
  - List of steps taken (scrollable):
    - Step name, duration, outcome (✓ | skipped | ✗)
    - If failed: error message, error code, timestamp
  - If running: current step highlighted, live log tail (last 20 lines, auto-scrolling)
  - If running: buttons Pause, Cancel
  - If paused: buttons Resume, Retry, Cancel
  - If failed: full error message, stack trace, recovery options (Retry/Skip/Quarantine)
  - If completed: all steps green, total duration, Close button
```
**Current App**: ✗ NOT IMPLEMENTED  
**Endpoints**: Missing all job-detail endpoints  
**Status**: CRITICAL MISSING ✗

---

### Backend Spec: Routers Screen
```
Purpose: See roster and state of all routers
Default: All routers
Filters: Online | Offline | Quarantined
Per router: name, IP, model, firmware version, status badge, last heartbeat, current job
Tap router → Router Detail
Tap quarantined router → Quarantine Reason screen
```
**Current App**: Partially implemented  
**Endpoints**: `GET /routers`, `GET /routers/:id`  
- ✓ Router listing exists
- ✓ Router detail exists
- ✗ No filtering by status (online/offline/quarantined)
- ✗ No current job display
- ✗ No last heartbeat
- ✗ No quarantine-related endpoints

**Status**: PARTIAL MISMATCH ✗

---

### Backend Spec: Router Detail Screen
```
Purpose: Operational state of a single router
Displays:
  - Full identity: name, IP, model, MAC, firmware version, last boot time
  - Status: online/offline/quarantined with timestamp
  - Last heartbeat, next expected heartbeat (if online)
  - Current or last job ID (if any)
  - Config revision (version of active config on router)
  - Network metrics (if available): latency, packet loss
  - If online and idle: "No active job"
  - If provisioning in progress: current job summary
  - If offline: duration offline, manual retry button
  - If quarantined: reason, timestamp, Release button with confirmation
```
**Current App**: Partially implemented  
**Endpoints**: `GET /routers/:id`, `POST /routers/:id/health-check`, `GET /routers/:id/live-stats`  
- ✓ Basic router info available
- ✓ Health check endpoint exists
- ✓ Live stats endpoint exists (but returns client traffic, not router metrics)
- ✗ No MAC address
- ✗ No firmware version display (available in API but not shown)
- ✗ No last boot time
- ✗ No quarantine info
- ✗ No config revision tracking
- ✗ No network metrics (latency, packet loss)
- ✗ No "current job" display

**Status**: PARTIAL MISMATCH ✗

---

### Backend Spec: Quarantine Reason Screen
```
Purpose: Explain why router is in quarantine
Displays:
  - Router name, status = Quarantined
  - Human-readable reason
  - Timestamp router entered quarantine
  - Last job attempted (ID, failure reason)
  - How to clear: "Release from quarantine and try a new job"
Actions:
  - Back to Routers
  - Release button with confirmation
```
**Current App**: ✗ NOT IMPLEMENTED  
**Endpoints**: Missing all quarantine-related endpoints  
**Status**: CRITICAL MISSING ✗

---

### Backend Spec: Job Action Confirmation Screen
```
Purpose: Prevent accidental dangerous actions
When shown: Operator taps Cancel on running job, or Release on quarantined router
Displays:
  - Action being requested (e.g., "Cancel job 47382?")
  - What will happen (e.g., "Router will be left in partial state...")
  - Impact (e.g., "3 more steps would have run")
Buttons: Confirm | Back (default Back)
```
**Current App**: ✗ NOT IMPLEMENTED  
**Status**: CRITICAL MISSING ✗

---

### Backend Spec: Settings Screen
```
Purpose: Operator preferences and session control
Options:
  - Tenant name (read-only)
  - User email (read-only)
  - Auto-refresh interval (toggle: 30s | 1m | 5m | manual only)
  - Keep screen awake while job running (toggle)
  - Log out button (with confirmation)
  - App version
  - Backend URL (for debugging, not editable in V1)
```
**Current App**: Partially implemented (but for admin, not operator)  
**Endpoints**: `GET /settings`, `PATCH /settings`  
- ✓ Settings screen exists
- ✗ Operator-specific settings missing (auto-refresh, screen timeout, backend URL)
- ✗ Settings are admin-focused (not operator-focused)

**Status**: PARTIAL MISMATCH ✗

---

## 3. ROLE-BASED ACCESS CONTROL

### Backend Spec (Implicit Operator Model)
The spec assumes a single **"operator"** role with these permissions:
- `router:read` — View routers and jobs
- `job:read` — View job history and live logs
- `job:write` — Pause, resume, retry, cancel jobs
- `router:read` — View router state, health

**No multi-role model mentioned.** V1 spec: "Only operator credentials for entire tenant."

### Current App (Multi-Tier Admin Model)
```
enum UserRole {
  SUPER_ADMIN,    // Full system access
  ADMIN,          // Tenant admin, user management
  RESELLER,       // Can create/manage sub-tenants
  VIEWER          // Read-only access to own tenant
}
```

**Mismatch**: Role hierarchy is designed for SaaS billing/multi-tenant, not for operator job control.

### Missing Role Mapping
| Intended Role | Current Role | Mapping | Issue |
|---|---|---|---|
| Field Operator (pause/resume jobs) | ADMIN? VIEWER? | Undefined | No operator-specific role |
| Tenant Admin (manage operators) | ADMIN | Unclear | ADMIN can do too much |
| System Admin (billing, compliance) | SUPER_ADMIN | Unclear | No separation between ops and billing |

**Missing Endpoints for Role Enforcement**:
- `GET /auth/me` exists (returns authenticated user)
- `POST /auth/change-password` exists
- ✗ No role-specific permission checks on job actions
- ✗ No audit logging of who triggered which action (available in backend design but not enforced in app)

**Status**: MAJOR MISMATCH ✗

---

## 4. JOB MANAGEMENT ENDPOINTS — CRITICAL GAPS

### Backend Design Specifies
(Inferred from ARCHITECTURE.md and MOBILE_APP_SPEC_V1.md)

| Endpoint | Purpose | HTTP | Expected Response |
|---|---|---|---|
| `GET /jobs` | List all jobs (filtered by status) | GET | `{ data: Job[] }` |
| `GET /jobs/:id` | Get job detail + live log | GET | `{ data: Job, log: string[] }` |
| `POST /jobs/:id/pause` | Pause a running job | POST | `{ data: Job, status: "paused" }` |
| `POST /jobs/:id/resume` | Resume a paused job | POST | `{ data: Job, status: "running" }` |
| `POST /jobs/:id/retry` | Retry a failed step | POST | `{ data: Job, status: "running" }` |
| `POST /jobs/:id/cancel` | Cancel a running job | POST | `{ data: Job, status: "cancelled" }` |
| `POST /jobs/:id/confirm` | Confirm a dangerous action | POST | `{ data: Job, action_confirmed: true }` |

### Current App Provides
✗ **NONE OF THESE ENDPOINTS**

**Current Job-Related Endpoints in api.ts**: (None — jobs are not in the API client)

**Status**: CRITICAL MISSING ✗

---

## 5. ROUTER STATE & HEALTH ENDPOINTS

### Backend Design Specifies
| Endpoint | Purpose | Response |
|---|---|---|
| `GET /routers/:id/status` | Online/offline/quarantined state | `{ status: "online"\|"offline"\|"quarantined", last_heartbeat: timestamp }` |
| `GET /routers/:id/quarantine` | Quarantine reason (if applicable) | `{ reason: string, timestamp: timestamp, last_job_id: uuid }` |
| `POST /routers/:id/quarantine/release` | Release router from quarantine | `{ status: "online" }` |
| `POST /routers/:id/ping` | Manual retry (on-site verification) | `{ reachable: true\|false }` |

### Current App Provides
- ✓ `GET /routers/:id` (includes status)
- ✓ `POST /routers/:id/health-check` (ping endpoint, close to spec)
- ✗ No quarantine endpoint
- ✗ No quarantine/release endpoint

**Status**: PARTIAL MISMATCH ✗

---

## 6. AUDIT TRAIL & CONFIRMATION GUARANTEES

### Backend Design Specifies (ARCHITECTURE.md, V1_PRODUCT_CONTRACT.md)

**Every action must produce an audit event:**
```
AuditEvent
├── tenant_id
├── actor (user_id|service)
├── resource_type (router|config|job|peer)
├── resource_id (UUID)
├── action (create|update|delete|apply|verify|rollback)
├── before_state (JSON)
├── after_state (JSON)
├── reason (string) — WHY was this done?
├── created_at
└── metadata (extra context)
```

**Every dangerous action must be confirmed:**
- Pause job → confirmation dialog
- Cancel job → confirmation dialog
- Release quarantine → confirmation dialog
- Retry job → no confirmation (safe)
- Resume job → no confirmation (safe)

### Current App Provides
- ✓ Auth tokens are logged (via api.ts interceptor)
- ✓ All API calls use bearer token (authenticated)
- ✗ No audit events exposed to mobile app (no `/audit` endpoint)
- ✗ No confirmation dialogs on job actions (no job screens exist)
- ✗ No "who changed what and when" visibility to operator

**What's Missing**:
```
GET /audit?resource_type=job&resource_id=:id → List all actions on a job
GET /audit?actor=:user_id&days=7 → List all actions by an operator
```

**Status**: CRITICAL MISSING ✗

---

## 7. FAILURE UX & OFFLINE BEHAVIOR

### Backend Design Specifies

#### When Backend is Unreachable
- Red banner: "Backend unreachable since 09:45 AM"
- All screens show cached data with timestamp
- Action buttons disabled with tooltip: "Action unavailable. Backend unreachable."
- Operator can still read job history and last-known router states
- Once backend returns: banner clears, auto-refresh

#### When Job Fails Mid-Stream
- Job Detail immediately shows failed step in red
- Full error message is always shown
- Options always present: Retry, Skip (if safe), Abort
- No auto-retry in V1 (operator decides every time)

#### When Network is Slow/Lossy
- Spinner appears if refresh takes >3 seconds
- Live log has "⚠ Connection slow. Last update 5 sec ago."
- Operator knows log is stale

#### If App Goes Offline
- Red banner: "No internet connection"
- Cached screens still visible
- Action buttons disabled
- Auto-refresh disabled

### Current App Provides
- ✓ Token refresh logic (handles 401)
- ✓ Error handling in axios interceptor
- ✗ No offline banner
- ✗ No connectivity status indicator
- ✗ No cached data persistence (except tokens)
- ✗ No retry UI for failed requests
- ✗ No "connection slow" warning
- ✗ No auto-refresh logic

**Status**: CRITICAL MISSING ✗

---

## 8. DATA FLOW & CONSISTENCY

### Backend Design Specifies

**Source of truth**: Backend. Device (router) state is derived from backend, not vice versa.

**Operator workflow**:
1. Operator reviews config diff on web console
2. Operator clicks "APPLY"
3. Backend queues job, assigns to worker
4. Worker connects to router, applies config
5. Worker verifies config (reads back from router)
6. Operator sees job status in mobile app (pulls latest state from backend)
7. If failed: operator sees error, decides to retry/skip/abort

**Current app relationship**:
1. Admin creates router in app (via API)
2. App stores router in backend
3. App can read router list (via API)
4. ✓ This part matches

**But missing**:
- ✗ No job creation flow (only admin can create routers, not jobs)
- ✗ No job state tracking
- ✗ No config diff visualization
- ✗ No state convergence checking

**Status**: PARTIAL MISMATCH ✗

---

## 9. RESPONSE CONTRACTS

### Backend Design Specifies (ARCHITECTURE.md)

**Standard Success Response**:
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

**Standard Error Response**:
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

**HTTP Status Codes**:
```
200 OK             Successful GET, completed job
201 Created        New resource
202 Accepted       Job submitted (job is pending/running)
400 Bad Request    Invalid input
401 Unauthorized   Missing/invalid token
403 Forbidden      Valid token, insufficient permissions
404 Not Found      Resource doesn't exist
409 Conflict       State conflict (e.g., job already running)
```

### Current App Implementation (api.ts)

**Response Envelope**:
```typescript
type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  timestamp: string;
  requestId: string;
};
```

**Match**: ✓ MOSTLY. Uses `success: boolean` instead of `status: "success"|"error"`, but behavior is compatible.

**Error Handling**:
```typescript
export function extractErrorMessage(error: unknown): string {
  if (isUnauthorized(error)) return "Session expirée...";
  if (axios.isAxiosError(error)) return error.response?.data?.message || error.message;
  return "Une erreur est survenue.";
}
```

**Match**: ✓ Partial. Handles 401 specifically, extracts error messages, but doesn't expose error codes to operator (needed for diagnostic UI).

**Status**: PARTIAL MATCH ✓ (structure OK, but operator visibility missing)

---

## 10. OPERATOR FLOWS — COMPARISON

### Backend Spec: Flow 1 — Monitor a Deployment in Progress

```
1. Open app (auto-opens to Dashboard if signed in)
2. Dashboard shows "4 jobs running"
3. Tap "4 running" → Jobs List, filter=Running
4. Find the critical job
5. Tap job → Job Detail
6. Watch live log, see each step complete
7. If failure: read error, tap Retry
8. If success: close, go back to Dashboard
```

**Current App**: ✗ NOT SUPPORTED
- ✗ No "4 jobs running" badge
- ✗ No Jobs List
- ✗ No Job Detail
- ✗ No live log
- ✗ No retry action

**Status**: CRITICAL GAP ✗

---

### Backend Spec: Flow 2 — Respond to a Failed Job

```
1. Dashboard shows red banner: "1 job failed"
2. Tap recent event → Job Detail
3. Job Detail shows failed step with error message
4. Read error (e.g., "QoS rule references non-existent interface")
5. Options: Retry | Skip | Quarantine
6. If retry: Job Detail auto-refreshes, see new attempt
```

**Current App**: ✗ NOT SUPPORTED
- ✗ No failed job notification
- ✗ No Job Detail
- ✗ No error visibility
- ✗ No retry/skip/quarantine options

**Status**: CRITICAL GAP ✗

---

### Backend Spec: Flow 3 — Intervene on a Running Job

```
1. Dashboard shows "2 jobs running"
2. Operator notices a router is taking too long
3. Tap "2 running" → Jobs List
4. Find the slow job, long-press it
5. Quick actions: "Pause | Resume | Retry | Cancel"
6. Tap Pause → Confirmation: "Pause job 42010?"
7. Confirm → Job paused, Job List updates, status badge shows "Paused"
```

**Current App**: ✗ NOT SUPPORTED
- ✗ No job monitoring
- ✗ No pause/resume/cancel actions
- ✗ No confirmation dialogs

**Status**: CRITICAL GAP ✗

---

## 11. CRITICAL MISSING FEATURES

### Must Implement for V1 Contract Compliance

1. **Job Endpoints** (all CRITICAL)
   - `GET /jobs` — list jobs with status filtering
   - `GET /jobs/:id` — job detail with step log
   - `POST /jobs/:id/pause` — pause job
   - `POST /jobs/:id/resume` — resume job
   - `POST /jobs/:id/retry` — retry failed job
   - `POST /jobs/:id/cancel` — cancel job

2. **Job Screen** (CRITICAL)
   - Jobs List with status filtering (Running, Paused, Failed, Queued, Completed)
   - Job Detail with step list, live log, action buttons

3. **Confirmation Dialogs** (MAJOR)
   - Pause job → "Pause job 123? It will resume where it left off."
   - Cancel job → "Cancel job 123? Router will be left in partial state."
   - Release quarantine → "Release router from quarantine and enable provisioning?"

4. **Dashboard Metrics** (MAJOR)
   - Job status counts (running, paused, failed, queued)
   - Router status counts (online, offline, quarantined)
   - Last sync timestamp
   - Backend connectivity indicator

5. **Router Enhancements** (MAJOR)
   - Quarantine info (reason, timestamp)
   - Current job display
   - Status filtering (online/offline/quarantined)
   - Manual retry button

6. **Auto-Refresh** (MAJOR)
   - 30s default interval
   - Toggle in Settings
   - Respect battery/background state

7. **Offline Behavior** (MAJOR)
   - Red banner when offline
   - Cached data display
   - Disable action buttons

8. **Audit Visibility** (MINOR)
   - `GET /audit?resource_id=:job_id` endpoint
   - Show "who did what and when" in job detail

---

## 12. AUDIT TRAIL — WHAT'S TRACKED

### Backend Specifies (ARCHITECTURE.md)
All mutations produce audit events, stored as immutable append-only log:

| Action | Audit Event | Visible in App |
|---|---|---|
| Create job | `JOB_CREATED` | ✗ No |
| Approve job | `JOB_APPROVED` | ✗ No |
| Pause job | `JOB_PAUSED` | ✗ No |
| Cancel job | `JOB_CANCELLED` | ✗ No |
| Retry job | `JOB_RETRY_REQUESTED` | ✗ No |
| Release quarantine | `ROUTER_QUARANTINE_RELEASED` | ✗ No |
| Health check | `ROUTER_HEALTH_CHECK` | ✓ Partial (endpoint exists) |

**Current App**: No audit endpoint or UI for operator to see action history.

**Status**: CRITICAL MISSING ✗

---

## 13. RECOMMENDED CHANGES

### Phase 1: Implement Core Job Management (BLOCKING)
**Effort**: High (5-7 days)  
**Impact**: Unblocks all operator flows  
**Tasks**:
1. Add job endpoints to backend API (if missing) or expose existing ones
2. Create Jobs List screen with status filtering
3. Create Job Detail screen with step list and live log
4. Add pause/resume/cancel/retry action buttons
5. Add confirmation dialogs on dangerous actions
6. Wire up auto-refresh logic

### Phase 2: Update Dashboard (MAJOR)
**Effort**: Medium (2-3 days)  
**Tasks**:
1. Replace metrics endpoint to return job/router counts instead of revenue
2. Add backend connectivity indicator
3. Add last-sync timestamp
4. Show recent critical events

### Phase 3: Quarantine Management (MAJOR)
**Effort**: Medium (2 days)  
**Tasks**:
1. Add quarantine info to router detail
2. Create quarantine reason screen
3. Add release button with confirmation

### Phase 4: Offline & Performance (MAJOR)
**Effort**: Medium (2-3 days)  
**Tasks**:
1. Add offline banner
2. Implement data caching strategy
3. Add auto-refresh toggle in Settings
4. Add connection-slow warning

### Phase 5: Audit Visibility (MINOR)
**Effort**: Low (1 day)  
**Tasks**:
1. Add `/audit` endpoint to backend (if missing)
2. Show audit trail in Job Detail

---

## 14. CURRENT STATE BY FEATURE

| Feature | Backend | Mobile App | Match | Priority |
|---|---|---|---|---|
| **Auth** | ✓ Full | ✓ Full | ✓ | Done |
| **Router Inventory** | ✓ Full | ✓ Partial | ✗ | Medium |
| **Job Orchestration** | ✓ Full | ✗ None | ✗ | **CRITICAL** |
| **Job Monitoring** | ✓ Full | ✗ None | ✗ | **CRITICAL** |
| **Job Actions** | ✓ Full | ✗ None | ✗ | **CRITICAL** |
| **Quarantine Mgmt** | ✓ Full | ✗ None | ✗ | Major |
| **Auto-Refresh** | ✓ Full | ✗ None | ✗ | Major |
| **Offline Handling** | ✓ Full | ✗ None | ✗ | Major |
| **Audit Trail** | ✓ Full | ✗ None | ✗ | Minor |
| **Admin Dashboard** | ✗ Out of scope | ✓ Full | N/A | Done |
| **User Management** | ✓ Partial | ✓ Full | ✗ | Out of scope |
| **Billing** | ✗ Out of scope | ✓ Full | N/A | Done |

---

## 15. ROOT CAUSE ANALYSIS

**Why is the mobile app the wrong product?**

1. **Different Product Owner**: Backend was designed for **ISP operators** (field provisioning). Mobile app was built for **ISP resellers** (admin dashboard).

2. **No Requirement Alignment**: Mobile app spec (MOBILE_APP_SPEC_V1.md) was not translated into mobile implementation requirements. No screens match.

3. **Wrong Data Model**: App uses SaaS admin roles (SUPER_ADMIN, ADMIN, RESELLER, VIEWER). Backend specifies single "operator" role.

4. **Missing Endpoint Contracts**: Backend design doesn't specify job endpoints in detail. Mobile app never implemented them.

5. **Scope Creep**: Mobile app grew to include user management, billing, vouchers — features out of scope for operator console.

---

## 16. ASSUMPTIONS BOTH SIDES MUST RESPECT

### Backend Assumptions (Currently Enforced)
1. ✓ Mobile app calls `/api/v1/*` endpoints only
2. ✓ All requests include `Authorization: Bearer <token>`
3. ✓ All responses wrap data in `{ success, data, timestamp }`
4. ✓ Backend queues jobs; jobs are not executed synchronously
5. ✓ Router state is source of truth; app reads, never writes directly to router

### Mobile App Assumptions (Currently Violated)
1. ✗ Backend will expose job list, detail, action endpoints
2. ✗ Backend will expose quarantine endpoints
3. ✗ Backend will expose audit trail endpoints
4. ✗ Backend will include metric counts (jobs, routers) in dashboard endpoint
5. ✗ All dangerous actions (pause, cancel) require confirmation dialog

### New Assumptions Both Must Respect
1. **Consistency**: If app shows "job paused", backend state confirms job is paused (within <1s)
2. **Atomicity**: Job actions (pause, cancel) either fully succeed or fully fail; no partial states
3. **Idempotency**: Retrying a failed request twice has same effect as once (safe deduplication)
4. **Order**: Job steps are always shown in chronological order; no out-of-order events
5. **Finality**: Completed jobs never transition back to running (jobs only move forward)
6. **Auditability**: Every action is logged with actor, timestamp, before/after state

---

## 17. INTEGRATION ROADMAP

### Option A: Make Mobile App Match Backend Spec (Recommended)
**Timeline**: 2-3 weeks  
**Effort**: High  
**Outcome**: Mobile app becomes the operator console specified in MOBILE_APP_SPEC_V1.md

**Dependencies on Backend**:
- Job endpoints must be implemented/exposed
- Dashboard metrics endpoint must return job/router counts
- Audit endpoint must be available (optional for V1)

### Option B: Rewrite Backend to Match Mobile App
**Timeline**: 3-4 weeks  
**Effort**: Very High  
**Outcome**: Backend pivots from operator provisioning tool to admin SaaS dashboard

**Not recommended** — Backend design is solid for provisioning, mobile app design is wrong for use case.

### Option C: Implement Both (Backend + Two Mobile Apps)
**Timeline**: 4-5 weeks  
**Effort**: Very High  
**Outcome**: One backend, two mobile apps (admin dashboard + operator console)

**Feasible but expensive.** Recommend Option A instead.

---

## CONCLUSION

**The mobile app does NOT satisfy the contract specified in MOBILE_APP_SPEC_V1.md.** They are two different products:

- **Backend**: Designed for ISP field operators provisioning routers (read-heavy, high-confidence remote control)
- **Mobile App**: Designed for ISP resellers managing users and billing (admin dashboard)

**To achieve V1 product-market fit**, the mobile app must be refactored to implement the operator console as specified. This requires:

1. Adding job management screens (list, detail, actions)
2. Adding confirmation dialogs on dangerous actions
3. Implementing auto-refresh and offline handling
4. Adding quarantine management
5. Updating dashboard metrics
6. Ensuring all actions are audited and traceable

**Without these changes, integration testing will fail**, and field operators will not have the tools they need to monitor and intervene on running provisioning jobs.

---

**Document Authority**: System Architect  
**Next Review**: After mobile app refactoring begins  
**Sign-Off Required From**: Mobile Team Lead, Backend Team Lead, Product Manager
