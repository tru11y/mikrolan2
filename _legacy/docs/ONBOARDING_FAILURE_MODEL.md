# MikroLan Onboarding Failure Model

## 1. The Onboarding State Machine

Router onboarding is a linear, persistent state machine. Each router gets its own isolated async task; a failure on one router does not affect others.

```
NEW
 └─► API_OK      (API connectivity confirmed)
      └─► WG_READY   (WireGuard interface created, pubkey retrieved, IP assigned, backend peer added)
           └─► TUNNEL_UP  (WireGuard handshake confirmed within 120s)
                └─► LOCKED    (LAN API blocked, admin password rotated)
                     └─► DONE
```

`ERROR` is reachable from any state. The retry endpoint resets the router to `NEW` and replays the full sequence. All state transitions are persisted in SQLite; the machine survives a restart at any point.

Each step follows a **check-then-create** pattern: the operation verifies whether the target condition already exists before applying a change. This makes every step safe to replay.

---

## 2. Why FINALIZING Is the Most Sensitive Phase

The FINALIZING phase spans the transition from `TUNNEL_UP` to `LOCKED` and covers two operations: **disabling the LAN API** and **rotating the admin password**.

This is qualitatively different from earlier phases:

| Phase | Consequence of failure | Recovery path |
|---|---|---|
| API_OK | Nothing changed on router | Retry freely |
| WG_READY | Interface/peer may exist | Idempotent steps rebuild it |
| TUNNEL_UP | Tunnel failed to establish | Remove peer, retry |
| **FINALIZING** | **Router state is partially hardened** | **Depends on what completed** |

The sensitivity comes from two intersecting risks:

**Risk 1 – Credential split.** `rotate_admin_password` generates a new secret, writes it to the DB, then applies it to the router. If the router command succeeds but the DB write fails (or vice versa), the stored credential no longer matches the live credential. The operator loses access.

**Risk 2 – Idempotency breaks down.** Earlier steps check for existing resources (interface present? peer present?). `rotate_admin_password` has no reliable idempotent check — RouterOS does not signal "this password is already set." A blind retry applies a second random password, invalidating the one just stored in the DB.

**Risk 3 – Access path narrowing.** `disable_api_on_lan` removes the LAN API access used to reach the router throughout onboarding. If this succeeds and later steps fail, the only remaining path to the router is through the WireGuard tunnel. If the tunnel is also degraded, the router becomes unreachable.

---

## 3. Failure Classification

### 3.1 Safe-to-Retry Failures

These failures leave the router in a consistent, recoverable state. The standard retry (`POST /routers/{id}/retry`) is the correct action.

| Step | Failure | Why it is safe |
|---|---|---|
| `validate_api_access` | Network timeout, wrong credentials | Nothing written to router |
| `create_wg_mgmt_interface` | Timeout during create | Step checks for existence first; idempotent |
| `get_wg_pubkey` | Key not yet generated | Interface may exist; retry just re-reads it |
| `assign_wg_ip` | IP already assigned | Idempotent check; safe to replay |
| `add_wg_peer` | Peer already exists | Idempotent check by public key |
| `wait_tunnel_handshake` | Timeout (120s), transient connectivity loss | No router state changed; tunnel config is still in place |
| `disable_api_on_lan` | Timeout before firewall rule applied | Idempotent check by comment tag; safe to replay |

**Decision rule:** If the DB records `state = ERROR` and the failed step appears before or at `disable_api_on_lan`, and the error message indicates a network/timeout cause, retry is safe.

### 3.2 Do-Not-Retry Failures

These failures create ambiguity between the router's live state and what the DB believes. Retrying blindly can make the situation worse.

| Step | Failure scenario | Why it is dangerous |
|---|---|---|
| `rotate_admin_password` — router command succeeds, DB write fails | DB holds old password, router has new password | Next retry generates yet another new password; old credentials cannot authenticate; DB is now out of sync |
| `rotate_admin_password` — DB write succeeds, router command fails | DB holds new password, router has old password | Next retry may attempt to auth with the new password, which the router does not accept; also fails |
| `rotate_admin_password` — succeeds, then LAN API was not yet disabled | Router is in an inconsistent hardening state | State machine is at LOCKED but LAN is still open |
| `disable_api_on_lan` — firewall rule applied but confirmation lost | LAN access may be blocked; retry cannot verify | Idempotent only if the comment tag was written; if not, a second rule may be added |

**Decision rule:** If the failed step is `rotate_admin_password`, **do not issue an automated retry**. Escalate to a human operator with the full log. Verify whether the DB's `admin_pass_new` value matches what the router accepts before deciding next action.

---

## 4. Operator Decision Rules

These rules apply when a router is in `ERROR` state and the cause must be assessed before acting.

### Rule 1: Read the step name before retrying

Open `GET /routers/{id}/status` and find the last log entry with `status = error`. The `step` field tells you exactly where the machine stopped.

- Step is **before** `rotate_admin_password` → retry is safe.
- Step is `rotate_admin_password` or later → do not retry automatically (see Rule 3).

### Rule 2: Network errors are almost always safe

If the error message contains: `timeout`, `connection refused`, `unreachable`, `EOF`, or similar transport-level strings — and the step is in the safe-to-retry list — issue the retry. These failures indicate infrastructure, not data inconsistency.

### Rule 3: Credential errors require manual triage

If the step is `rotate_admin_password`:

1. Check `admin_pass_new` in the DB. If it is set, the DB write succeeded — the new password was generated and stored. Try authenticating to the router with that password.
2. If authentication with `admin_pass_new` succeeds → the router is locked, credentials are consistent. Reset state to `LOCKED` manually and mark as `DONE`.
3. If authentication with `admin_pass_new` fails → the router still uses the original password. Verify by authenticating with `password_encrypted`. If that works → the state machine can be resumed from `TUNNEL_UP` with careful manual intervention.
4. If neither credential works → the router is inaccessible. Physical or out-of-band access is required.

### Rule 4: Quarantine is an automatic escalation signal

The quarantine system tracks consecutive failures per router. At level 1, retries are still permitted. At level 2, they are blocked until an operator calls `POST /routers/{id}/release-quarantine` with an explicit reason (minimum 10 characters). At level 3, the router is fully blocked.

A quarantined router is a signal that automated recovery has already been attempted multiple times. Do not release quarantine without first diagnosing the root cause via the step log.

### Rule 5: TUNNEL_UP is a prerequisite for FINALIZING recovery

Before attempting any manual recovery on a FINALIZING failure, confirm the WireGuard tunnel is active. If the tunnel is down, restoring it must come first — without it, API access through WireGuard is not possible, and the LAN API may already be blocked.

---

## 5. Summary Table

| State at ERROR | Safe to retry? | First operator action |
|---|---|---|
| NEW | Yes | Retry |
| API_OK | Yes | Retry |
| WG_READY | Yes | Retry |
| TUNNEL_UP (handshake timeout) | Yes | Retry |
| TUNNEL_UP (disable_api step) | Yes | Retry |
| TUNNEL_UP (rotate_admin step) | **No** | Read logs, triage credentials |
| LOCKED | Investigate | Check if DONE can be set manually |

---

ONBOARDING FAILURE MODEL DOCUMENTED
