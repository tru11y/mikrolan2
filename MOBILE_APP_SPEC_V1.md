# MikroTik Provisioning SaaS — Mobile Operator App | V1 Specification

## 1. APP PURPOSE & BOUNDARIES

**The app is a mobile remote-control console for provisioning operations.**

The operator uses this phone app to:
- See what provisioning jobs are happening right now
- See why jobs failed
- Intervene (pause, resume, retry, cancel) on jobs in flight
- View the roster of routers and their state
- Know when a router is in quarantine and why

The app does **not** create, schedule, or design provisioning jobs. Job creation happens in the web console. The mobile app is read-heavy with high-confidence remote control.

**Why this app exists:** ISP operators need to see and stop a broken provisioning mid-flight while on-site at a customer location or in a truck. The backend blueprint is failure-safe, but the operator must be able to see the failure and act fast. A phone in hand is the operator's first tool when something breaks.

---

## 2. SCREEN LIST (V1)

### Login Screen
- **Purpose:** Authenticate to a tenant
- **Inputs:** Email, password
- **Outcome:** Session token stored locally; operator signed in to one tenant
- **State:** Clear if login fails with reason (backend down, invalid creds, tenant not found)
- **Behavior:** After successful login, go to Dashboard

### Dashboard (Home)
- **Purpose:** Snapshot of right-now operational state
- **Displays:**
  - Count of jobs by status (running, paused, failed, queued)
  - Count of routers by state (online, offline, quarantined)
  - Last sync timestamp (when app last refreshed from backend)
  - Red banner if app is offline or backend is unreachable
  - Recent critical events: last 3 job failures with timestamps
- **Actions:** Tap status count → go to Jobs screen; tap router count → go to Routers screen
- **Refresh:** Manual pull-to-refresh; auto-refresh every 30s if online (respects battery, won't refresh if app backgrounded >5 min)

### Jobs List Screen
- **Purpose:** See all provisioning jobs, filtered by status
- **Default view:** Running and paused jobs (most relevant)
- **Filters (tabs):** Running | Paused | Failed | Queued | Completed (last 24h)
- **Per job displays:**
  - Job ID, target router, status badge, progress (if running)
  - Timestamp started, ETA if available
  - Current step (e.g., "Uploading config 2/5")
- **Tap a job** → Job Detail screen
- **Long-press a job (running/paused only)** → Inline quick actions: Pause | Resume | Retry | Cancel

### Job Detail Screen
- **Purpose:** Full operational view of a single job
- **Displays (always):**
  - Job ID, tenant, target router hostname/IP
  - Status with timestamp (started, paused, failed, completed)
  - Progress bar (if running or paused)
  - List of steps taken (scrollable):
    - Step name, duration, outcome (success ✓ | skipped | failed ✗)
    - If failed: error message, error code, timestamp
- **If running:**
  - Current step highlighted with spinner
  - Live log tail (last 20 lines, auto-scrolling)
  - Buttons: Pause, Cancel
- **If paused:**
  - Reason shown ("Paused by operator" or "Auto-paused on config validation error")
  - Buttons: Resume, Retry, Cancel
- **If failed:**
  - Failed step highlighted in red
  - Full error message, stack trace if present
  - Affected step and recovery options:
    - "Retry from this step" (button)
    - "Skip this step and continue" (button, disabled if safety rule blocks)
    - "Cancel and quarantine router" (button)
- **If completed:**
  - All steps green
  - Total duration
  - Button: Close
- **Always present:** Back button, refresh (manual)

### Routers Screen
- **Purpose:** See roster and state of all routers in tenant
- **Default view:** All routers
- **Filters (tabs):** Online | Offline | Quarantined
- **Per router displays:**
  - Router name (hostname), IP, model, firmware version
  - Status badge (online, offline, quarantined)
  - Last heartbeat timestamp (if online) or "Last seen 2h ago"
  - Current job (if one is running): job ID, progress
- **Tap a router** → Router Detail screen
- **Tap router in Quarantine filter** → Quarantine Reason screen

### Router Detail Screen
- **Purpose:** Operational state of a single router
- **Displays:**
  - Full identity: name, IP, model, MAC, firmware version, last boot time
  - Status: online/offline/quarantined with timestamp
  - Last heartbeat, next expected heartbeat (if online)
  - Current or last job ID (if any)
  - Config revision (version of active config on router)
  - Network metrics (if available from backend): latency, packet loss
- **If online and idle:**
  - "No active job"
  - Option to manually trigger a config push (if backend supports)
- **If provisioning in progress:**
  - Current job summary (link to Job Detail)
- **If offline:**
  - Duration offline
  - Manual retry button (pings router, doesn't force)
- **If quarantined:**
  - Reason (e.g., "Config validation failed", "Failed to reach after 3 retries")
  - Timestamp quarantined
  - Button: Release from quarantine (with confirmation)

### Quarantine Reason Screen
- **Purpose:** Explain why a router is in quarantine
- **Displays:**
  - Router name, status = Quarantined
  - Human-readable reason
  - Timestamp router entered quarantine
  - Last job attempted (ID, failure reason)
  - How to clear: "Release from quarantine and try a new job"
- **Actions:**
  - Back to Routers
  - Release button (shows confirmation: "Quarantine will be cleared. Ready?")

### Job Action Confirmation Screen
- **Purpose:** Prevent accidental dangerous actions
- **When shown:** Operator taps Cancel on a running job, or Release on a quarantined router
- **Displays:**
  - Action being requested (e.g., "Cancel job 47382?")
  - What will happen (e.g., "Router will be left in partial state. You must fix it manually.")
  - Impact (e.g., "3 more steps would have run")
- **Buttons:** Confirm | Back (default Back)
- **After confirm:** Action sent to backend, Job Detail refreshes, shows result

### Settings Screen
- **Purpose:** Operator preferences and session control
- **Options:**
  - Tenant name (read-only display)
  - User email (read-only)
  - Auto-refresh interval (toggle: 30s | 1m | 5m | manual only)
  - Keep screen awake while job is running (toggle: on/off)
  - Log out button (confirmation: "You will be signed out")
  - App version
  - Backend URL (for debugging, not editable in V1)

---

## 3. CORE OPERATOR FLOWS

### Flow 1: Monitor a Deployment in Progress
1. Open app (auto-opens to Dashboard if signed in)
2. Dashboard shows "4 jobs running"
3. Tap "4 running" → Jobs List, filter=Running
4. Find the critical job
5. Tap job → Job Detail
6. Watch live log, see each step complete
7. If failure: read error, tap Retry to re-run failed step
8. If success: close, go back to Dashboard

**Success criteria:** Operator sees every step in real-time, can stop immediately if something looks wrong.

### Flow 2: Respond to a Failed Job
1. Dashboard shows red banner: "1 job failed"
2. Tap recent event "Job 47382 failed: Config validation" → Job Detail
3. Job Detail shows failed step: "Validate config" with error message
4. Read error (e.g., "QoS rule references non-existent interface")
5. Options:
   - Tap "Retry from this step" (backend is re-running now)
   - Tap "Skip and continue" (if safety rules allow)
   - Tap "Cancel and quarantine" (operator decides router is not ready)
6. If retry: Job Detail auto-refreshes, see new attempt
7. If skip: Job continues, shows next step
8. If quarantine: Router moves to Quarantine, operator notes reason elsewhere

**Success criteria:** Operator understands *why* the job failed, has options that are safe, doesn't get stuck.

### Flow 3: Intervene on a Running Job
1. Dashboard shows "2 jobs running"
2. Operator notices a router is taking too long
3. Tap "2 running" → Jobs List
4. Find the slow job, long-press it
5. Quick actions appear: "Pause | Resume | Retry | Cancel"
6. Tap Pause
7. Confirmation screen: "Pause job 42010? It will resume where it left off."
8. Confirm → Job paused, Job List updates immediately, status badge shows "Paused"
9. Operator checks the router manually (SSH, Web UI, etc.)
10. Tap job again → Job Detail, tap Resume
11. Confirmation: "Resume job 42010?"
12. Confirm → Job resumes

**Success criteria:** Operator can pause without losing state, investigate offline, resume safely. No cascading failures from pausing.

### Flow 4: Release a Quarantined Router
1. Dashboard shows "2 routers quarantined"
2. Tap "2 quarantined" → Routers, filter=Quarantined
3. Find problematic router
4. Tap router → Router Detail → shows "Quarantined: Config validation failed 1h ago"
5. Operator has fixed the issue manually (e.g., repaired network cable)
6. Tap Release button
7. Confirmation: "Release router from quarantine and enable provisioning?"
8. Confirm → Router state changes to "Online", Quarantine cleared
9. Operator can now schedule a new job for this router

**Success criteria:** Operator controls quarantine state, not the app.

### Flow 5: Check Offline Router
1. Dashboard shows "1 router offline"
2. Tap "1 offline" → Routers, filter=Offline
3. Find offline router, tap it → Router Detail
4. Shows "Offline for 45 minutes, last seen 09:15 AM"
5. Tap manual retry button: "Ping router?"
6. App sends ping, waits 10 seconds
7. Result: "Still unreachable" or "Back online!"
8. If still offline: operator knows network path is broken, goes on-site
9. If back online: back to Dashboard, can proceed with provisioning

**Success criteria:** Operator gets signal quickly, doesn't hang the app waiting.

---

## 4. FAILURE UX PHILOSOPHY

**Core rule: Never hide, never decide for the operator.**

### When the Backend is Unreachable
- Red banner on Dashboard: "Backend unreachable since 09:45 AM"
- All screens show cached data with timestamp (e.g., "Last updated 2 min ago")
- Any action button (Pause, Resume, Retry, etc.) becomes disabled with tooltip: "Action unavailable. Backend unreachable."
- Operator can still read job history, last-known router states, and reason for decisions
- Once backend returns: banner clears, app auto-refreshes all screens
- If backend is down >1 hour, suggest: "Backend is offline. Check status page or contact support."

### When a Job Fails Mid-Stream
- Job Detail immediately shows the failed step in red
- Full error message is always shown (not truncated, not hidden behind a "More" button)
- Error includes: error code, affected component, timestamp, last successful step
- Operator sees: "What step failed? Why? What can I do?"
- Options are **always** present:
  - Retry (restart this step)
  - Skip (if safe; e.g., can't skip a power-on)
  - Abort (stop and quarantine the router)
- No "auto-retry" in V1. Operator decides every time.

### When a Router Is Unreachable
- Router Detail shows "Offline for X minutes"
- If provisioning was in progress: job is auto-paused, reason shown in Job Detail
- Operator is not charged with making the decision to quarantine; they can choose to retry or cancel
- If offline >N minutes (configurable, default 10): suggestion shown: "Router offline for 10 min. Consider canceling this job and investigating on-site."

### When a Step Is Unsafe to Skip
- Skip button is disabled with tooltip: "Cannot skip power-on. Router will not boot."
- Operator sees the constraint, not a blank refusal

### When Network is Slow / Lossy
- Dashboard refresh takes >3 seconds: spinner appears, operator can cancel
- Job Detail: live log has "⚠ Connection slow. Last update 5 sec ago."
- Operator knows the log is stale, not live
- Buttons still work (e.g., Pause still sends the command), but operator knows delay is expected

---

## 5. DEGRADED / OFFLINE BEHAVIOR

### If App Goes Offline (No Cellular, No WiFi)
- Dashboard shows red banner: "No internet connection"
- All cached screens still visible (last-known state)
- All action buttons disabled: "No internet. Cannot send commands."
- Refresh button disabled: "No internet."
- As soon as network returns: app auto-refreshes, buttons re-enable

### If Phone Battery is Critical (<5%)
- One-time banner on Dashboard: "Battery critical. Save your work and charge."
- App will not attempt auto-refresh (respects device state)
- Operator can still read and tap buttons (manual actions still send)

### If Phone Loses Signal Briefly (<10 sec)
- No banner, silent retry
- Request automatically re-sent when signal returns
- If request was lost and not sent: next manual refresh catches it

### If Backend Responds Slowly (>10 sec)
- Loading spinner on the screen that was refreshed
- Operator can tap back or navigate away (doesn't cancel the request)
- Request continues in background
- When response arrives: screen auto-updates if still visible, or silent sync

### If Operator Closed App While a Job was Running
- Next time app opens: Dashboard shows current state from backend
- If job is still running: operator can open Job Detail and continue monitoring
- No state is lost on the backend (backend is source of truth)

---

## 6. OPERATOR SAFETY GUARDS

### Guard 1: Confirmation on Dangerous Actions
- **Pause, Resume, Retry, Cancel** always show a confirmation dialog
- Dialog repeats what will happen (e.g., "Pause will stop the job after the current step completes.")
- Default button is always "Back" (not the dangerous action)

### Guard 2: Quarantine is Explicit
- Router is never auto-quarantined by the app
- Only these actions quarantine a router:
  - Operator taps "Cancel and quarantine"
  - Backend auto-pauses (due to unreachable) and marks "Can only proceed if operator resumes or cancels"
- Quarantine always has a human-readable reason
- Operator must explicitly Release to clear quarantine

### Guard 3: Cannot Skip Safety-Critical Steps
- Some steps cannot be skipped (e.g., power sequence, boot validation)
- Skip button is disabled for these with reason shown
- Backend defines what can be skipped; app enforces it

### Guard 4: No Concurrent Jobs on Same Router
- Dashboard prevents operator from accidentally starting a second job on a router already provisioning
- If operator tries: "This router is already running job 47382. Complete or cancel it first."

### Guard 5: Session Timeout
- If operator doesn't interact with app for 15 minutes, session expires
- Next action (tap refresh, tap button) prompts re-login
- No silent logout; operator sees the prompt

### Guard 6: Changes Require Explicit Confirmation, Shown on Screen
- Operator taps any action (Pause, Resume, Retry, Cancel, Release)
- Confirmation dialog appears on screen with full context
- Operator confirms by tapping confirmation button
- No modal dialogs that can be dismissed by accident
- Result of action shown immediately on the Job Detail or Router Detail screen

---

## 7. MOBILE APP NON-GOALS (V1)

**Out of scope for V1. Operators must use web console for these:**

- Creating or scheduling provisioning jobs
- Editing router configurations
- Managing users or tenants
- Viewing historical analytics (job success rate, average duration, etc.)
- Bulk operations (delete 50 routers, retry all failed jobs)
- Custom alerting or webhooks
- Exporting reports or logs
- Real-time metrics dashboard (CPU, memory, packet loss on routers)
- Firmware image upload or management
- Dark mode (use system default)
- Offline-first work (app requires internet to send commands)
- Push notifications (operator must pull to see updates)
- VoIP or messaging within the app
- Multi-tenant switching (log out and log in to switch tenants)
- QR code scanning for router discovery
- Map view of router locations
- Automated remediation (auto-skip steps, auto-retry, auto-rollback)

---

## SUMMARY: The Operator's Phone is a Console, Not a Control Panel

The mobile app is a **read-heavy, high-confidence remote control** for ISP operators in the field.

An operator with this app can:
- ✓ See what's happening right now
- ✓ Read failure messages and understand why
- ✓ Pause a job without losing state
- ✓ Retry a failed step or skip a non-critical one
- ✓ Check a router's status from across town
- ✓ Release a quarantined router once they've fixed the issue
- ✓ Work offline (read-only) and sync when back online

An operator **cannot** (and doesn't need to):
- ✗ Create or design jobs (web console)
- ✗ Edit configs (web console)
- ✗ Manage tenants (web console)
- ✗ Automate decisions (operator decides)

**V1 philosophy:** The app is a faithful mirror of the backend state. If the backend is safe, the app is safe. If the operator understands the backend, they understand the app.
