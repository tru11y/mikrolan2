"""
Onboarding worker: state machine for provisioning a single router.
Each router gets its own task; tasks run concurrently without locks.
"""
import asyncio
import os
from typing import Optional
import secrets

from models import (
    Router,
    RouterState,
    get_router,
    update_router_state,
    update_router_wg_pubkey,
    update_router_admin_password,
    log_step,
)
import routeros_api

# Encryption (simplified; in production use fernet or similar)
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "test-key-32-bytes-long-xxxxxxx")


def decrypt_password(encrypted: str) -> str:
    """Decrypt password (placeholder; use Fernet in production)."""
    # In production: from cryptography.fernet import Fernet
    # return Fernet(ENCRYPTION_KEY).decrypt(encrypted).decode()
    return encrypted


def encrypt_password(plain: str) -> str:
    """Encrypt password (placeholder)."""
    return plain


async def onboarding_worker(router_id: str, backend_wg_pubkey: str):
    """
    Main onboarding state machine for one router.
    Each router runs independently; exceptions don't affect others.
    All state transitions are logged and persisted in DB.
    """
    router = get_router(router_id)
    if not router:
        print(f"Router {router_id} not found")
        return

    ip = router.ip
    username = router.username
    password = decrypt_password(router.password_encrypted)

    # State machine: each step is idempotent
    try:
        # ==================== STEP 1: Validate API Access ====================
        if router.state in (RouterState.NEW,):
            log_step(router_id, "validate_api_access", "start")
            try:
                ok = await routeros_api.validate_api_access(ip, username, password)
                if not ok:
                    raise routeros_api.RouterOSError("API not reachable")
                update_router_state(router_id, RouterState.API_OK)
                log_step(router_id, "validate_api_access", "success")
            except Exception as e:
                log_step(router_id, "validate_api_access", "error", str(e))
                update_router_state(
                    router_id, RouterState.ERROR, error=f"API access failed: {e}"
                )
                return

        # Reload router state (another task might have advanced it)
        router = get_router(router_id)
        if router.state == RouterState.ERROR:
            return

        # ==================== STEP 2: Create WireGuard Interface ====================
        if router.state in (RouterState.API_OK,):
            log_step(router_id, "create_wg_mgmt_interface", "start")
            try:
                await routeros_api.create_wg_mgmt_interface(
                    ip, username, password, interface_name="wg-mgmt"
                )
                log_step(router_id, "create_wg_mgmt_interface", "success")
            except Exception as e:
                log_step(router_id, "create_wg_mgmt_interface", "error", str(e))
                update_router_state(
                    router_id,
                    RouterState.ERROR,
                    error=f"Failed to create WG interface: {e}",
                )
                return

        # ==================== STEP 3: Get Router WireGuard Public Key ====================
        if router.state in (RouterState.API_OK,):
            log_step(router_id, "get_wg_pubkey", "start")
            try:
                pubkey = await routeros_api.get_wg_interface_pubkey(
                    ip, username, password, interface_name="wg-mgmt"
                )
                update_router_wg_pubkey(router_id, pubkey)
                log_step(router_id, "get_wg_pubkey", "success")
                update_router_state(router_id, RouterState.WG_READY)
            except Exception as e:
                log_step(router_id, "get_wg_pubkey", "error", str(e))
                update_router_state(
                    router_id, RouterState.ERROR, error=f"Failed to get WG pubkey: {e}"
                )
                return

        # Reload
        router = get_router(router_id)
        if router.state == RouterState.ERROR:
            return

        # ==================== STEP 4: Assign WireGuard IP ====================
        if router.state in (RouterState.WG_READY,):
            log_step(router_id, "assign_wg_ip", "start")
            try:
                await routeros_api.assign_wg_ip_address(
                    ip, username, password, router.wg_ip, interface_name="wg-mgmt"
                )
                log_step(router_id, "assign_wg_ip", "success")
            except Exception as e:
                log_step(router_id, "assign_wg_ip", "error", str(e))
                update_router_state(
                    router_id, RouterState.ERROR, error=f"Failed to assign WG IP: {e}"
                )
                return

        # ==================== STEP 5: Add Backend as WireGuard Peer ====================
        if router.state in (RouterState.WG_READY,):
            log_step(router_id, "add_wg_peer", "start")
            try:
                # Backend WireGuard peer (frontend)
                await routeros_api.add_wg_peer(
                    ip,
                    username,
                    password,
                    peer_pubkey=backend_wg_pubkey,
                    allowed_address="10.0.0.0/24",  # Backend tunnel subnet
                    endpoint=None,  # Backend will initiate from dynamic IP
                    interface_name="wg-mgmt",
                )
                log_step(router_id, "add_wg_peer", "success")
            except Exception as e:
                log_step(router_id, "add_wg_peer", "error", str(e))
                update_router_state(
                    router_id, RouterState.ERROR, error=f"Failed to add WG peer: {e}"
                )
                return

        # ==================== STEP 6: Wait for Tunnel Handshake ====================
        if router.state in (RouterState.WG_READY,):
            log_step(router_id, "wait_tunnel_handshake", "start")
            try:
                await routeros_api.wait_tunnel_handshake(
                    ip, username, password, interface_name="wg-mgmt", timeout_sec=120
                )
                log_step(router_id, "wait_tunnel_handshake", "success")
                update_router_state(router_id, RouterState.TUNNEL_UP)
            except Exception as e:
                log_step(router_id, "wait_tunnel_handshake", "error", str(e))
                update_router_state(
                    router_id,
                    RouterState.ERROR,
                    error=f"Tunnel handshake failed: {e}",
                )
                return

        # Reload
        router = get_router(router_id)
        if router.state == RouterState.ERROR:
            return

        # ==================== STEP 7: Disable API on LAN ====================
        if router.state in (RouterState.TUNNEL_UP,):
            log_step(router_id, "disable_api_on_lan", "start")
            try:
                await routeros_api.disable_api_on_lan(
                    ip, username, password, api_port=8728
                )
                log_step(router_id, "disable_api_on_lan", "success")
            except Exception as e:
                log_step(router_id, "disable_api_on_lan", "error", str(e))
                update_router_state(
                    router_id,
                    RouterState.ERROR,
                    error=f"Failed to disable API on LAN: {e}",
                )
                return

        # ==================== STEP 8: Rotate Admin Password ====================
        if router.state in (RouterState.TUNNEL_UP,):
            log_step(router_id, "rotate_admin_password", "start")
            try:
                new_pass = secrets.token_urlsafe(16)
                await routeros_api.rotate_admin_password(
                    ip, username, password, new_password=new_pass, admin_username="admin"
                )
                # Store new password (encrypted)
                update_router_admin_password(
                    router_id, encrypt_password(new_pass)
                )
                log_step(router_id, "rotate_admin_password", "success")
                update_router_state(router_id, RouterState.LOCKED)
            except Exception as e:
                log_step(router_id, "rotate_admin_password", "error", str(e))
                update_router_state(
                    router_id,
                    RouterState.ERROR,
                    error=f"Failed to rotate admin password: {e}",
                )
                return

        # ==================== FINAL: Mark as DONE ====================
        log_step(router_id, "onboarding", "success")
        update_router_state(router_id, RouterState.DONE)
        print(f"✓ Router {router_id} ({ip}) onboarded successfully")

    except Exception as e:
        # Catch-all for unexpected errors
        log_step(router_id, "onboarding", "error", str(e))
        update_router_state(router_id, RouterState.ERROR, error=f"Unexpected error: {e}")
        print(f"✗ Router {router_id} ({ip}) failed: {e}")


async def spawn_onboarding_task(
    router_id: str, backend_wg_pubkey: str
) -> asyncio.Task:
    """
    Spawn an onboarding task for a router (runs concurrently with others).
    """
    return asyncio.create_task(onboarding_worker(router_id, backend_wg_pubkey))


async def spawn_multiple_tasks(
    router_ids: list, backend_wg_pubkey: str
) -> list:
    """
    Spawn multiple onboarding tasks concurrently.
    Returns list of tasks; caller can await them or let them run in background.
    """
    tasks = []
    for router_id in router_ids:
        task = await spawn_onboarding_task(router_id, backend_wg_pubkey)
        tasks.append(task)
    return tasks
