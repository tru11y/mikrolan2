"""
Cleanup worker: restores router to pre-onboarding state, then removes DB records.

Two-phase design (mandatory for DONE routers):

  Phase 1 — via WireGuard tunnel IP (wg_ip), current (rotated) credentials:
    C1. Reset admin password to original   ← do first; if we lose connection, password is restored
    C2. Remove firewall rule allow-api-wg  ← LAN API fully open after this
    C3. Remove firewall rule block-api-lan

  Phase 2 — via LAN IP, original credentials (restored in C1):
    C4. Remove WireGuard peer
    C5. Remove WireGuard IP address
    C6. Remove WireGuard interface

  Phase 3 — backend DB (only after all router steps succeed):
    C7. Delete onboarding_logs + quarantine_state
    C8. Null out password_encrypted and admin_pass_new (secrets zeroed)
    C9. Set state = DELETED

Why this order:
  - C1 before C6: password is restored before we lose the WG tunnel.
  - C2-C3 before C6: LAN API is open before we kill the WG interface (no lockout).
  - Phase 3 only after all router steps: secrets are never deleted before cleanup is verified.

Safety contract:
  - DONE/LOCKED only: cleanup requires admin_pass_new to connect via WG tunnel.
  - ERROR state: automatic cleanup is refused; manual steps are required (see prior analysis).
  - If any step fails → state = DELETE_FAILED, secrets remain in DB for retry.
  - Retrying is safe: all router steps are idempotent (check-then-remove).

Risk:
  MANUAL NEEDED if WireGuard tunnel is down at cleanup time (backend WG server restarted).
  In that case, connect via Winbox/SSH with admin_pass_new from the DB and run manual cleanup.
"""
import asyncio

from crypto import decrypt_secret
from models import (
    RouterState,
    get_router,
    update_router_state,
    log_step,
    delete_router_data,
    clear_router_secrets,
)
import routeros_api


async def cleanup_worker(router_id: str, backend_wg_pubkey: str) -> None:
    """
    Automatic cleanup of a DONE router. Spawned by DELETE /routers/{router_id}.
    Uses stored encrypted credentials — no password prompt required.
    """
    router = get_router(router_id)
    if not router:
        print(f"Cleanup: router {router_id} not found in DB")
        return

    ip = router.ip
    username = router.username
    wg_ip = router.wg_ip  # e.g. "10.0.0.2/24"

    # Only automatic cleanup for DONE routers (password was rotated, WG tunnel is up).
    # ERROR state requires manual intervention — credentials and WG state are uncertain.
    if router.state not in (RouterState.DONE, RouterState.LOCKED):
        msg = (
            f"Automatic cleanup refused: router is in state {router.state.value}. "
            "Only DONE/LOCKED routers support automatic cleanup. "
            "Use Winbox or SSH to clean up manually."
        )
        log_step(router_id, "cleanup", "error", msg)
        update_router_state(router_id, RouterState.DELETE_FAILED, error=msg)
        return

    if not router.admin_pass_new:
        msg = "admin_pass_new is NULL — cannot authenticate with rotated credentials"
        log_step(router_id, "cleanup", "error", msg)
        update_router_state(router_id, RouterState.DELETE_FAILED, error=msg)
        return

    if not router.password_encrypted:
        msg = "password_encrypted is NULL — cannot restore original password"
        log_step(router_id, "cleanup", "error", msg)
        update_router_state(router_id, RouterState.DELETE_FAILED, error=msg)
        return

    if not wg_ip:
        msg = "wg_ip is NULL — cannot connect via WireGuard tunnel"
        log_step(router_id, "cleanup", "error", msg)
        update_router_state(router_id, RouterState.DELETE_FAILED, error=msg)
        return

    # Decrypt in memory only. Variables are deleted immediately after use.
    try:
        current_pass = decrypt_secret(router.admin_pass_new)
        original_pass = decrypt_secret(router.password_encrypted)
    except RuntimeError as e:
        msg = f"Secret decryption failed: {e}"
        log_step(router_id, "cleanup", "error", msg)
        update_router_state(router_id, RouterState.DELETE_FAILED, error=msg)
        return

    # WireGuard tunnel IP (strip /prefix — connect to router's WG IP, not LAN IP)
    wg_connect_ip = wg_ip.split("/")[0]

    update_router_state(router_id, RouterState.DELETING)
    last_success = "none"

    try:
        # ── Phase 1: via WireGuard tunnel (current rotated password) ──────────

        # C1: Reset admin password to original FIRST.
        #     If the WG tunnel drops after this, the router is still accessible via Winbox/SSH.
        log_step(router_id, "cleanup_reset_password", "start",
                 "Resetting admin password to original (via WG tunnel)")
        try:
            await routeros_api.reset_admin_password(
                wg_connect_ip, username, current_pass,
                original_password=original_pass,
                admin_username="admin",
            )
            log_step(router_id, "cleanup_reset_password", "success")
            last_success = "reset_password"
        except Exception as e:
            log_step(router_id, "cleanup_reset_password", "error", str(e))
            update_router_state(
                router_id, RouterState.DELETE_FAILED,
                error=f"Stopped at reset_password (last_success={last_success}): {e}",
            )
            return
        finally:
            # Password is restored — we no longer need current_pass
            del current_pass

        # C2-C3: Remove both firewall rules. LAN API is open after C3.
        for fw_comment in ("allow-api-wg", "block-api-lan"):
            step_name = f"cleanup_remove_fw_{fw_comment.replace('-', '_')}"
            log_step(router_id, step_name, "start", f"Removing firewall rule '{fw_comment}'")
            try:
                await routeros_api.remove_firewall_rule_by_comment(
                    wg_connect_ip, username, original_pass, comment=fw_comment
                )
                log_step(router_id, step_name, "success")
                last_success = step_name
            except Exception as e:
                log_step(router_id, step_name, "error", str(e))
                update_router_state(
                    router_id, RouterState.DELETE_FAILED,
                    error=f"Stopped at {step_name} (last_success={last_success}): {e}",
                )
                return

        # ── Phase 2: via LAN IP (original credentials, WG not yet removed) ────

        # C4: Remove WireGuard peer
        log_step(router_id, "cleanup_remove_wg_peer", "start",
                 "Removing WG peer (backend pubkey) via LAN")
        try:
            await routeros_api.remove_wg_peer_by_pubkey(
                ip, username, original_pass,
                peer_pubkey=backend_wg_pubkey,
                interface_name="wg-mgmt",
            )
            log_step(router_id, "cleanup_remove_wg_peer", "success")
            last_success = "remove_wg_peer"
        except Exception as e:
            log_step(router_id, "cleanup_remove_wg_peer", "error", str(e))
            update_router_state(
                router_id, RouterState.DELETE_FAILED,
                error=f"Stopped at remove_wg_peer (last_success={last_success}): {e}",
            )
            return

        # C5: Remove WireGuard IP address
        log_step(router_id, "cleanup_remove_wg_ip", "start",
                 f"Removing WG IP {wg_ip} from wg-mgmt via LAN")
        try:
            await routeros_api.remove_wg_ip_address(
                ip, username, original_pass,
                wg_ip=wg_ip,
                interface_name="wg-mgmt",
            )
            log_step(router_id, "cleanup_remove_wg_ip", "success")
            last_success = "remove_wg_ip"
        except Exception as e:
            log_step(router_id, "cleanup_remove_wg_ip", "error", str(e))
            update_router_state(
                router_id, RouterState.DELETE_FAILED,
                error=f"Stopped at remove_wg_ip (last_success={last_success}): {e}",
            )
            return

        # C6: Remove WireGuard interface
        log_step(router_id, "cleanup_remove_wg_iface", "start",
                 "Removing WireGuard interface wg-mgmt via LAN")
        try:
            await routeros_api.remove_wg_interface(
                ip, username, original_pass, interface_name="wg-mgmt"
            )
            log_step(router_id, "cleanup_remove_wg_iface", "success")
            last_success = "remove_wg_iface"
        except Exception as e:
            log_step(router_id, "cleanup_remove_wg_iface", "error", str(e))
            update_router_state(
                router_id, RouterState.DELETE_FAILED,
                error=f"Stopped at remove_wg_iface (last_success={last_success}): {e}",
            )
            return

        # ── Phase 3: backend DB — only after all router steps confirmed ────────

        # C7: Delete logs and quarantine state
        log_step(router_id, "cleanup_db", "start", "Removing onboarding logs and quarantine state")
        delete_router_data(router_id)

        # C8: Zero out credential columns immediately
        clear_router_secrets(router_id)

        # C9: Mark as DELETED
        update_router_state(router_id, RouterState.DELETED)
        print(f"✓ Router {router_id} ({ip}) fully cleaned up — state=DELETED, secrets zeroed")

    except Exception as e:
        log_step(router_id, "cleanup", "error", str(e))
        update_router_state(
            router_id, RouterState.DELETE_FAILED,
            error=f"Unexpected cleanup error: {e}",
        )
        print(f"✗ Router {router_id} ({ip}) cleanup failed: {e}")
    finally:
        # Belt-and-suspenders: ensure original_pass is freed regardless of path
        try:
            del original_pass
        except NameError:
            pass
