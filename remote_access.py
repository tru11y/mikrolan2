"""
Remote access endpoints — VPS → WireGuard tunnel → router.
Purely additive: zero changes to onboarding logic.
Only reachable when router state is TUNNEL_UP or DONE.
"""
import asyncio
from datetime import datetime

import librouteros
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from crypto import decrypt_secret
from models import RouterState, get_router, log_step
from permissions import get_permission, log_audit

router = APIRouter(tags=["remote-access"])

_ALLOWED_STATES = {RouterState.TUNNEL_UP, RouterState.DONE}
_CONN_TIMEOUT = 10  # seconds — tunnel is local, short timeout is correct

_SAFE_ACTIONS: dict = {
    "get-identity":   "/system/identity/print",
    "get-resources":  "/system/resource/print",
    "get-interfaces": "/interface/print",
    "get-logs":       "/log/print",
    "get-routes":     "/ip/route/print",
}
_ALL_ACTIONS = set(_SAFE_ACTIONS) | {"reboot"}

_PATH_SAFE_CHARS = set(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/."
)

# Strict read-only prefix whitelist for /remote/command.
# Only paths under these subtrees are allowed; anything mutating goes through /remote/action.
_READONLY_PREFIXES = (
    "/system/identity/",
    "/system/resource/",
    "/system/routerboard/",
    "/system/health/",
    "/interface/",
    "/ip/address/",
    "/ip/route/",
    "/ip/arp/",
    "/ip/dns/",
    "/ip/firewall/filter/",
    "/ip/firewall/nat/",
    "/log/",
    "/routing/ospf/",
    "/routing/bgp/",
    "/caps-man/",
    "/wireless/",
)

def _is_readonly_path(path: str) -> bool:
    """Return True only if path starts with a whitelisted read-only prefix."""
    p = path if path.endswith("/") else path + "/"
    return any(p.startswith(prefix) for prefix in _READONLY_PREFIXES)


class CommandRequest(BaseModel):
    path: str  # RouterOS API path, e.g. "/ip/address/print"


class ActionRequest(BaseModel):
    action: str  # one of _ALL_ACTIONS


# ── internal helpers ──────────────────────────────────────────────────────────

def _wg_host(wg_ip: str) -> str:
    return wg_ip.split("/")[0]


def _credentials(r):
    """Return (host, username, password) for the WireGuard-tunnel connection."""
    host = _wg_host(r.wg_ip)
    ciphertext = r.admin_pass_new or r.password_encrypted
    return host, r.username, decrypt_secret(ciphertext)


async def _api_call(host: str, username: str, password: str, path: str) -> list:
    api = await asyncio.wait_for(
        librouteros.async_connect(host=host, username=username, password=password),
        timeout=_CONN_TIMEOUT,
    )
    try:
        return [item async for item in api(path)]
    finally:
        try:
            await api.close()
        except Exception:
            pass


def _require_router(router_id: str):
    """Fetch router, 404 if missing, 409 if tunnel not active."""
    r = get_router(router_id)
    if not r:
        raise HTTPException(status_code=404, detail="Router not found")
    if r.state not in _ALLOWED_STATES:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Remote access requires state TUNNEL_UP or DONE "
                f"(current: {r.state.value})"
            ),
        )
    return r


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/routers/{router_id}/remote/status")
async def remote_status(router_id: str, user_id: str = Header(default="anonymous", alias="X-User-ID")):
    """
    GET /routers/{router_id}/remote/status
    Fetch identity + resource snapshot from the router via WireGuard tunnel.
    Always returns 200; sets reachable=False on failure instead of raising.
    Requires can_view permission.
    """
    perm = get_permission(user_id, router_id)
    if not perm.can_view:
        log_audit(user_id, router_id, "remote_status", False, "permission denied: can_view required")
        raise HTTPException(status_code=403, detail="Permission denied: can_view required")

    r = _require_router(router_id)
    host, username, password = _credentials(r)
    try:
        identity = await _api_call(host, username, password, "/system/identity/print")
        resources = await _api_call(host, username, password, "/system/resource/print")
        log_step(router_id, "remote_status", "success", f"Reached via {host}")
        log_audit(user_id, router_id, "remote_status", True, f"host={host}")
        return {
            "router_id": router_id,
            "tunnel_host": host,
            "reachable": True,
            "identity": identity[0] if identity else {},
            "resources": resources[0] if resources else {},
            "error": None,
            "fetched_at": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        log_step(router_id, "remote_status", "error", str(e))
        log_audit(user_id, router_id, "remote_status", False, str(e))
        return {
            "router_id": router_id,
            "tunnel_host": host,
            "reachable": False,
            "identity": {},
            "resources": {},
            "error": str(e),
            "fetched_at": datetime.utcnow().isoformat(),
        }


@router.post("/routers/{router_id}/remote/command")
async def remote_command(router_id: str, req: CommandRequest, user_id: str = Header(default="anonymous", alias="X-User-ID")):
    """
    POST /routers/{router_id}/remote/command
    Run a RouterOS API path (read-only paths only, e.g. /ip/address/print).
    Always returns 200; error field set on failure.
    Requires can_remote_read permission.
    """
    perm = get_permission(user_id, router_id)
    if not perm.can_remote_read:
        log_audit(user_id, router_id, "remote_command", False, "permission denied: can_remote_read required")
        raise HTTPException(status_code=403, detail="Permission denied: can_remote_read required")

    r = _require_router(router_id)
    path = req.path.strip()
    if not path.startswith("/") or len(path) > 200 or not all(
        c in _PATH_SAFE_CHARS for c in path[1:]
    ):
        raise HTTPException(status_code=400, detail="Invalid RouterOS API path")
    if not _is_readonly_path(path):
        raise HTTPException(
            status_code=403,
            detail=(
                "Path not in read-only whitelist. "
                "Use /remote/action for mutating operations."
            ),
        )

    host, username, password = _credentials(r)
    try:
        result = await _api_call(host, username, password, path)
        log_step(router_id, "remote_command", "success", f"path={path}")
        log_audit(user_id, router_id, "remote_command", True, f"path={path}")
        return {
            "router_id": router_id,
            "path": path,
            "result": result,
            "error": None,
            "executed_at": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        log_step(router_id, "remote_command", "error", f"path={path} err={e}")
        log_audit(user_id, router_id, "remote_command", False, f"path={path} err={e}")
        return {
            "router_id": router_id,
            "path": path,
            "result": None,
            "error": str(e),
            "executed_at": datetime.utcnow().isoformat(),
        }


@router.post("/routers/{router_id}/remote/action")
async def remote_action(router_id: str, req: ActionRequest, user_id: str = Header(default="anonymous", alias="X-User-ID")):
    """
    POST /routers/{router_id}/remote/action
    Execute a named predefined action on the router.
    Allowed: get-identity, get-resources, get-interfaces, get-logs, get-routes, reboot.
    Always returns 200; error field set on failure.
    Requires can_remote_action (or can_reboot for reboot action).
    """
    perm = get_permission(user_id, router_id)
    if req.action == "reboot":
        if not perm.can_reboot:
            log_audit(user_id, router_id, "remote_action:reboot", False, "permission denied: can_reboot required")
            raise HTTPException(status_code=403, detail="Permission denied: can_reboot required")
    else:
        if not perm.can_remote_action:
            log_audit(user_id, router_id, f"remote_action:{req.action}", False, "permission denied: can_remote_action required")
            raise HTTPException(status_code=403, detail="Permission denied: can_remote_action required")

    r = _require_router(router_id)
    if req.action not in _ALL_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown action. Allowed: {sorted(_ALL_ACTIONS)}",
        )

    host, username, password = _credentials(r)
    try:
        if req.action == "reboot":
            api = await asyncio.wait_for(
                librouteros.async_connect(host=host, username=username, password=password),
                timeout=_CONN_TIMEOUT,
            )
            try:
                # Router drops the connection immediately on reboot — that's expected
                async for _ in api("/system/reboot"):
                    break
            except Exception:
                pass
            finally:
                try:
                    await api.close()
                except Exception:
                    pass
            log_step(router_id, "remote_action", "success", "reboot sent")
            log_audit(user_id, router_id, "remote_action:reboot", True, "reboot sent")
            return {
                "router_id": router_id,
                "action": "reboot",
                "result": "Reboot command sent",
                "error": None,
                "executed_at": datetime.utcnow().isoformat(),
            }

        path = _SAFE_ACTIONS[req.action]
        result = await _api_call(host, username, password, path)
        log_step(router_id, "remote_action", "success", req.action)
        log_audit(user_id, router_id, f"remote_action:{req.action}", True, f"path={path}")
        return {
            "router_id": router_id,
            "action": req.action,
            "result": result,
            "error": None,
            "executed_at": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        log_step(router_id, "remote_action", "error", f"{req.action}: {e}")
        log_audit(user_id, router_id, f"remote_action:{req.action}", False, str(e))
        return {
            "router_id": router_id,
            "action": req.action,
            "result": None,
            "error": str(e),
            "executed_at": datetime.utcnow().isoformat(),
        }
