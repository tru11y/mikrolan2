"""
FastAPI router for advanced access endpoints.

All endpoints require can_remote_action AND can_reboot (enforced by
_require_advanced_permission before any DB or iptables operation).
The router must be in TUNNEL_UP or DONE state (enforced inside create_session).

Endpoints (all purely additive — existing endpoints are untouched):
  POST   /routers/{router_id}/advanced-access
  GET    /routers/{router_id}/advanced-access
  GET    /routers/{router_id}/advanced-access/{access_id}
  DELETE /routers/{router_id}/advanced-access/{access_id}
"""
import os

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from advanced_access import (
    DEFAULT_DURATION_SECONDS,
    MAX_DURATION_SECONDS,
    SERVICE_PORTS,
    create_session,
    get_router_session,
    list_sessions,
    teardown_session,
)
from models import get_router
from permissions import get_permission, log_audit

router = APIRouter(tags=["advanced-access"])

# VPS public host returned in the create response so clients know where to connect.
# Defaults to the host portion of VPS_WG_ENDPOINT if not explicitly set.
_vps_wg_endpoint = os.getenv("VPS_WG_ENDPOINT", "149.28.232.230:51820")
VPS_PUBLIC_HOST: str = os.getenv(
    "VPS_PUBLIC_HOST",
    _vps_wg_endpoint.split(":")[0],
)


# ── Permission gate ────────────────────────────────────────────────────────────

def _require_advanced_permission(user_id: str, router_id: str) -> None:
    """
    Raise HTTP 403 unless the caller holds can_remote_action AND can_reboot.
    Also writes a denial entry to audit_logs.
    """
    perm = get_permission(user_id, router_id)
    if not (perm.can_remote_action and perm.can_reboot):
        log_audit(
            user_id, router_id,
            "advanced_access:denied",
            False,
            "requires can_remote_action AND can_reboot",
        )
        raise HTTPException(
            status_code=403,
            detail=(
                "Advanced access requires can_remote_action AND can_reboot permissions. "
                "Contact your administrator."
            ),
        )


# ── Request model ──────────────────────────────────────────────────────────────

class CreateAdvancedAccessRequest(BaseModel):
    service: str
    duration_seconds: int = DEFAULT_DURATION_SECONDS


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/routers/{router_id}/advanced-access", status_code=201)
async def create_advanced_access(
    router_id: str,
    req: CreateAdvancedAccessRequest,
    user_id: str = Header(default="anonymous", alias="X-User-ID"),
):
    """
    POST /routers/{router_id}/advanced-access

    Create a time-boxed TCP forwarding session from a VPS ephemeral port to a
    service on the router, routed through the existing WireGuard tunnel.

    - Router must be TUNNEL_UP or DONE.
    - Requires can_remote_action AND can_reboot.
    - Duration is clamped to 1 – MAX_DURATION_SECONDS (default 5 min, max 60 min).
    - Fails closed: if the iptables rule cannot be installed, 503 is returned and
      no session record is persisted.

    Returns the session record including vps_host, allocated_port, and
    connect_url so the client can open the appropriate application.
    """
    r = get_router(router_id)
    if not r:
        raise HTTPException(status_code=404, detail="Router not found")

    _require_advanced_permission(user_id, router_id)

    if req.service not in SERVICE_PORTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown service '{req.service}'. Allowed: {sorted(SERVICE_PORTS)}",
        )
    if not (1 <= req.duration_seconds <= MAX_DURATION_SECONDS):
        raise HTTPException(
            status_code=400,
            detail=f"duration_seconds must be between 1 and {MAX_DURATION_SECONDS}",
        )

    try:
        session = create_session(
            router_id=router_id,
            user_id=user_id,
            service=req.service,
            duration_seconds=req.duration_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    result = session.as_dict()
    result["vps_host"] = VPS_PUBLIC_HOST
    result["connect_url"] = _build_connect_url(req.service, VPS_PUBLIC_HOST, session.allocated_port)
    return result


@router.get("/routers/{router_id}/advanced-access")
async def list_advanced_access(
    router_id: str,
    user_id: str = Header(default="anonymous", alias="X-User-ID"),
):
    """
    GET /routers/{router_id}/advanced-access

    List the 50 most recent access sessions for a router (all statuses).
    Requires can_remote_action AND can_reboot.
    """
    r = get_router(router_id)
    if not r:
        raise HTTPException(status_code=404, detail="Router not found")

    _require_advanced_permission(user_id, router_id)

    return {"router_id": router_id, "sessions": list_sessions(router_id)}


@router.get("/routers/{router_id}/advanced-access/{access_id}")
async def get_advanced_access(
    router_id: str,
    access_id: str,
    user_id: str = Header(default="anonymous", alias="X-User-ID"),
):
    """
    GET /routers/{router_id}/advanced-access/{access_id}

    Return the current status of a specific access session.
    Requires can_remote_action AND can_reboot.
    """
    r = get_router(router_id)
    if not r:
        raise HTTPException(status_code=404, detail="Router not found")

    _require_advanced_permission(user_id, router_id)

    session = get_router_session(router_id, access_id)
    if not session:
        raise HTTPException(status_code=404, detail="Access session not found")

    return session.as_dict()


@router.delete("/routers/{router_id}/advanced-access/{access_id}")
async def delete_advanced_access(
    router_id: str,
    access_id: str,
    user_id: str = Header(default="anonymous", alias="X-User-ID"),
):
    """
    DELETE /routers/{router_id}/advanced-access/{access_id}

    Immediately revoke an active session: removes the iptables DNAT rule and
    marks the record as revoked.  Idempotent — calling on an already-inactive
    session returns 200 without error.
    Requires can_remote_action AND can_reboot.
    """
    r = get_router(router_id)
    if not r:
        raise HTTPException(status_code=404, detail="Router not found")

    _require_advanced_permission(user_id, router_id)

    session = get_router_session(router_id, access_id)
    if not session:
        raise HTTPException(status_code=404, detail="Access session not found")

    if session.status != "active":
        return {
            "access_id": access_id,
            "status": session.status,
            "message": "Session is already inactive; nothing to do.",
        }

    teardown_session(session, status="revoked", actor_user_id=user_id)
    log_audit(user_id, router_id, "advanced_access:revoke", True, f"access_id={access_id}")

    return {
        "access_id": access_id,
        "status": "revoked",
        "message": "Session revoked. iptables DNAT rule removed.",
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _build_connect_url(service: str, vps_host: str, port: int) -> str:
    if service == "webfig-ssl":
        return f"https://{vps_host}:{port}"
    if service == "webfig":
        return f"http://{vps_host}:{port}"
    if service == "winbox":
        return f"winbox://{vps_host}:{port}"
    return f"{vps_host}:{port}"
