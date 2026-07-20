"""
FastAPI application for MikroTik provisioning backend.
Minimal, production-ready MVP.
"""
import asyncio
import os
import uuid
from typing import Optional
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse

from models import (
    init_db,
    create_router,
    get_router,
    get_logs,
    log_step,
    get_quarantine_state,
    RouterState,
    update_router_state,
)
from onboarding import spawn_onboarding_task
from quarantine import on_job_complete, release_quarantine, check_quarantine_gate
from cleanup import cleanup_worker
from crypto import encrypt_secret, _derive_key
# ── Advanced access additions (additive — no existing code changed) ────────────
from permissions import init_permissions_tables
from advanced_access import init_advanced_access_tables, start_cleanup_loop
from advanced_access_router import router as advanced_access_router

app = FastAPI(title="MikroTik Provisioning Backend", version="0.1.0")

app.include_router(advanced_access_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://localhost:8000",
        "https://139.84.241.27:8443",
        "https://139.84.241.27",
        "null",
    ],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=False,
)

# Global set to track active tasks (for graceful shutdown)
active_tasks = set()

# VPS WireGuard public key — set via env var on VPS
BACKEND_WG_PUBKEY = os.getenv(
    "BACKEND_WG_PUBKEY", "0000000000000000000000000000000000000000000"
)
# VPS WireGuard endpoint that routers dial to establish the tunnel
VPS_WG_ENDPOINT = os.getenv("VPS_WG_ENDPOINT", "149.28.232.230:51820")


class OnboardRequest(BaseModel):
    """Request to onboard a new router."""

    ip: str
    username: str
    password: str
    wg_peer_ip: Optional[str] = "10.0.0.2"  # Default WG IP for this router


class OnboardResponse(BaseModel):
    """Response to onboarding request — includes VPS WG config and bootstrap script."""

    router_id: str
    state: str
    status_url: str
    vps_wg_pubkey: str
    vps_endpoint: str
    assigned_wg_ip: str
    bootstrap_script: str


class RegisterPubkeyRequest(BaseModel):
    """Router reports its WireGuard public key after running the bootstrap script."""

    pubkey: str


class RouterStatusResponse(BaseModel):
    """Current status of a router."""

    id: str
    ip: str
    state: str
    wg_pubkey: Optional[str]
    wg_ip: Optional[str]
    error: Optional[str]
    progress: list
    created_at: str
    updated_at: str


class QuarantineStatusResponse(BaseModel):
    """Current quarantine status of a router."""

    router_id: str
    quarantine_level: int
    consecutive_failures: int
    triggered_by_job_id: Optional[str]
    last_failure_at: Optional[str]
    quarantined_at: Optional[str]
    reason: Optional[str]


class ReleaseQuarantineRequest(BaseModel):
    """Request to release router from quarantine."""

    reason: str
    target_level: int = 0


class ReleaseQuarantineResponse(BaseModel):
    """Response after releasing quarantine."""

    status: str
    router_id: str
    quarantine_level: int
    released_at: str
    release_reason: str


class QuarantineEventResponse(BaseModel):
    """Quarantine audit event."""

    id: int
    event_type: str
    level_before: Optional[int]
    level_after: Optional[int]
    triggered_by: str
    triggered_by_id: Optional[str]
    message: str
    created_at: str


@app.on_event("startup")
async def startup():
    """Initialize database on startup."""
    init_db()
    print("✓ Database initialized")
    # ── Advanced access additions ──────────────────────────────────────────────
    init_permissions_tables()
    print("✓ Permissions tables initialized")
    init_advanced_access_tables()
    print("✓ Advanced access tables initialized")
    task = start_cleanup_loop()
    active_tasks.add(task)
    print("✓ Advanced access cleanup loop started")
    # ──────────────────────────────────────────────────────────────────────────
    # Fail fast if encryption key is missing or insecure — never silently store plaintext
    try:
        _derive_key()
        print("✓ Encryption key validated")
    except RuntimeError as e:
        raise RuntimeError(f"Startup aborted: {e}")


@app.on_event("shutdown")
async def shutdown():
    """Gracefully shut down active tasks."""
    print("Shutting down...")
    for task in active_tasks:
        if not task.done():
            task.cancel()
    await asyncio.gather(*active_tasks, return_exceptions=True)
    print("✓ All tasks completed")


def _build_bootstrap_script(
    router_id: str,
    vps_pubkey: str,
    vps_endpoint: str,
    wg_ip: str,
) -> str:
    vps_host, vps_port = vps_endpoint.rsplit(":", 1)
    api_base = f"http://{vps_host}:8000"
    return f"""\
# MikroLan Bootstrap Script — router_id={router_id}
:local routerId "{router_id}"
:local vpsPubkey "{vps_pubkey}"
:local vpsEndpoint "{vps_host}"
:local vpsPort {vps_port}
:local wgIp "{wg_ip}"
:local apiBase "{api_base}"

# 1. Create WireGuard interface (no-op if exists)
:do {{ /interface wireguard add name=wg-mgmt mtu=1420 }} on-error={{}}
:delay 3

# 2. Wait for key generation
:local routerPubkey ""
:local tries 0
:while ([:len $routerPubkey] = 0 && $tries < 20) do={{
    :set routerPubkey [/interface wireguard get [find name=wg-mgmt] public-key]
    :delay 1
    :set tries ($tries + 1)
}}
:if ([:len $routerPubkey] = 0) do={{
    :log error "MikroLan: failed to get WG pubkey"; :error "no pubkey"
}}

# 3. Add VPS as peer (no-op if exists)
:do {{
    /interface wireguard peers add interface=wg-mgmt public-key=$vpsPubkey \\
        allowed-address=0.0.0.0/0 endpoint-address=$vpsEndpoint \\
        endpoint-port=$vpsPort persistent-keepalive=25
}} on-error={{}}

# 4. Assign tunnel IP (no-op if exists)
:do {{ /ip address add address=$wgIp interface=wg-mgmt }} on-error={{}}

# 5. Report pubkey to cloud
:local body ("{{\\"pubkey\\":\\"" . $routerPubkey . "\\"}}")
/tool/fetch url=($apiBase . "/routers/" . $routerId . "/register-pubkey") \\
    http-method=post \\
    http-header-field="Content-Type: application/json" \\
    http-data=$body \\
    output=none

:log info ("MikroLan: bootstrap complete, tunnel connecting...")
"""


@app.post("/routers/onboard", response_model=OnboardResponse)
async def onboard_router(req: OnboardRequest):
    """
    POST /routers/onboard
    Register router, return VPS WG config + RouterOS bootstrap script.
    No background task is started here — the worker starts only after the
    router calls POST /routers/{id}/register-pubkey.
    """
    router_id = f"{req.ip}_{uuid.uuid4().hex[:8]}"

    if not req.ip or not req.username:
        raise HTTPException(status_code=400, detail="Missing credentials")

    existing_router = get_router(router_id)
    if existing_router:
        allowed, block_reason = check_quarantine_gate(router_id, "apply")
        if not allowed:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "ROUTER_QUARANTINED",
                    "message": block_reason,
                    "details": get_quarantine_state(router_id).as_dict() if get_quarantine_state(router_id) else None,
                },
            )

    try:
        create_router(
            router_id=router_id,
            ip=req.ip,
            username=req.username,
            password_encrypted=encrypt_secret(req.password),
            wg_ip=req.wg_peer_ip,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create router: {e}")

    script = _build_bootstrap_script(
        router_id=router_id,
        vps_pubkey=BACKEND_WG_PUBKEY,
        vps_endpoint=VPS_WG_ENDPOINT,
        wg_ip=req.wg_peer_ip,
    )

    return OnboardResponse(
        router_id=router_id,
        state="NEW",
        status_url=f"/routers/{router_id}/status",
        vps_wg_pubkey=BACKEND_WG_PUBKEY,
        vps_endpoint=VPS_WG_ENDPOINT,
        assigned_wg_ip=req.wg_peer_ip,
        bootstrap_script=script,
    )


@app.post("/routers/{router_id}/register-pubkey")
async def register_router_pubkey(
    router_id: str,
    req: RegisterPubkeyRequest,
    background_tasks: BackgroundTasks,
):
    """
    POST /routers/{router_id}/register-pubkey
    Called by the router's bootstrap script after WG interface is created.
    Registers the router's WG pubkey, adds it as a peer on the VPS interface,
    and launches the finalisation worker (wait handshake → disable LAN API → rotate password).
    """
    router = get_router(router_id)
    if not router:
        raise HTTPException(status_code=404, detail="Router not found")

    if router.state not in (RouterState.NEW, RouterState.ERROR):
        return JSONResponse(
            {"message": f"Router already in state {router.state.value}", "router_id": router_id},
            status_code=200,
        )

    pubkey = req.pubkey.strip()
    if not pubkey:
        raise HTTPException(status_code=400, detail="pubkey is required")

    from models import update_router_wg_pubkey
    update_router_wg_pubkey(router_id, pubkey)

    try:
        from routeros_api import _add_backend_wg_peer
        _add_backend_wg_peer(
            router_pubkey=pubkey,
            router_wg_ip=router.wg_ip or "10.0.0.2/24",
        )
        log_step(router_id, "configure_backend_wg_peer", "success",
                 "VPS WG peer added, no endpoint (router dials VPS)")
    except Exception as e:
        log_step(router_id, "configure_backend_wg_peer", "error", str(e))
        update_router_state(router_id, RouterState.ERROR,
                            error=f"Failed to add VPS WG peer: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to configure WG peer: {e}")

    update_router_state(router_id, RouterState.WG_READY)
    log_step(router_id, "register_pubkey", "success",
             f"Pubkey registered, WG peer added. Launching finalisation worker.")

    async def run_finalisation():
        task = None
        try:
            task = await spawn_onboarding_task(router_id, BACKEND_WG_PUBKEY)
            active_tasks.add(task)
            await task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"Finalisation task error for {router_id}: {e}")
        finally:
            if task:
                active_tasks.discard(task)

    background_tasks.add_task(run_finalisation)

    return {
        "router_id": router_id,
        "state": "WG_READY",
        "message": "Pubkey registered. Finalisation started. Poll /status for progress.",
    }


@app.get("/routers/{router_id}/status", response_model=RouterStatusResponse)
async def get_router_status(router_id: str):
    """
    GET /routers/{router_id}/status
    Get current status and progress of a router's onboarding.
    """
    router = get_router(router_id)
    if not router:
        raise HTTPException(status_code=404, detail="Router not found")

    progress = get_logs(router_id)

    return RouterStatusResponse(
        id=router.id,
        ip=router.ip,
        state=router.state.value,
        wg_pubkey=router.wg_pubkey,
        wg_ip=router.wg_ip,
        error=router.error,
        progress=progress,
        created_at=router.created_at.isoformat() if router.created_at else None,
        updated_at=router.updated_at.isoformat() if router.updated_at else None,
    )


@app.post("/routers/{router_id}/retry")
async def retry_onboarding(router_id: str, background_tasks: BackgroundTasks):
    """
    POST /routers/{router_id}/retry
    Retry failed onboarding. Safe to call multiple times.
    """
    router = get_router(router_id)
    if not router:
        raise HTTPException(status_code=404, detail="Router not found")

    if router.state.value != "ERROR":
        return JSONResponse(
            {
                "message": f"Cannot retry: router is in state {router.state.value}",
                "router_id": router_id,
            },
            status_code=409,
        )

    from models import update_router_state, RouterState

    if router.wg_pubkey:
        # Pubkey already registered — retry finalisation from WG_READY
        update_router_state(router_id, RouterState.WG_READY, error=None)
        log_step(router_id, "retry", "start", "Retrying finalisation (pubkey already registered)")

        async def run_retry():
            task = None
            try:
                task = await spawn_onboarding_task(router_id, BACKEND_WG_PUBKEY)
                active_tasks.add(task)
                await task
            except Exception as e:
                print(f"Retry task error: {e}")
            finally:
                if task:
                    active_tasks.discard(task)

        background_tasks.add_task(run_retry)
        return {"message": "Retry initiated (finalisation)", "router_id": router_id}
    else:
        # No pubkey — user must re-run the bootstrap script
        update_router_state(router_id, RouterState.NEW, error=None)
        log_step(router_id, "retry", "start", "Reset to NEW — awaiting bootstrap script")
        return {
            "message": "Reset to NEW. Please re-run the bootstrap script on your router.",
            "router_id": router_id,
        }


@app.get("/routers/{router_id}/quarantine-status", response_model=QuarantineStatusResponse)
async def get_quarantine_status(router_id: str):
    """
    GET /routers/{router_id}/quarantine-status
    Get current quarantine status of a router.
    """
    router = get_router(router_id)
    if not router:
        raise HTTPException(status_code=404, detail="Router not found")

    quarantine = get_quarantine_state(router_id)
    if not quarantine:
        raise HTTPException(status_code=404, detail="Quarantine state not found")

    return QuarantineStatusResponse(
        router_id=quarantine.router_id,
        quarantine_level=quarantine.level,
        consecutive_failures=quarantine.consecutive_failures,
        triggered_by_job_id=quarantine.triggered_by_job_id,
        last_failure_at=quarantine.last_failure_at.isoformat() if quarantine.last_failure_at else None,
        quarantined_at=quarantine.quarantined_at.isoformat() if quarantine.quarantined_at else None,
        reason=quarantine.reason,
    )


@app.post("/routers/{router_id}/release-quarantine", response_model=ReleaseQuarantineResponse)
async def release_router_quarantine(router_id: str, req: ReleaseQuarantineRequest):
    """
    POST /routers/{router_id}/release-quarantine
    Release router from quarantine.
    """
    router = get_router(router_id)
    if not router:
        raise HTTPException(status_code=404, detail="Router not found")

    if not router.tenant_id:
        raise HTTPException(status_code=400, detail="Router has no tenant_id")

    quarantine = get_quarantine_state(router_id)
    if not quarantine or quarantine.level == 0:
        raise HTTPException(status_code=409, detail="Router is not in quarantine")

    if req.target_level != 0:
        raise HTTPException(status_code=400, detail="Can only release to level 0")

    if len(req.reason) < 10:
        raise HTTPException(status_code=400, detail="Reason must be at least 10 characters")

    success = await release_quarantine(router_id, router.tenant_id, req.reason)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to release quarantine")

    updated_quarantine = get_quarantine_state(router_id)
    return ReleaseQuarantineResponse(
        status="success",
        router_id=router_id,
        quarantine_level=updated_quarantine.level,
        released_at=updated_quarantine.released_at.isoformat(),
        release_reason=updated_quarantine.release_reason,
    )


@app.delete("/routers/{router_id}")
async def delete_router(router_id: str, background_tasks: BackgroundTasks):
    """
    DELETE /routers/{router_id}

    Triggers real automatic cleanup of a provisioned router.
    Returns 202 immediately; poll GET /routers/{router_id}/status for progress.
    """
    router = get_router(router_id)
    if not router:
        raise HTTPException(status_code=404, detail="Router not found")

    if router.state in (RouterState.DELETING, RouterState.DELETED):
        return JSONResponse(
            {"message": f"Router is already in state {router.state.value}", "router_id": router_id},
            status_code=409,
        )

    if router.state in (RouterState.NEW, RouterState.API_OK, RouterState.WG_READY, RouterState.TUNNEL_UP):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Router is in transitional state {router.state.value}. "
                "Wait for onboarding to complete (DONE or ERROR) before deleting."
            ),
        )

    if router.state in (RouterState.DONE, RouterState.LOCKED) and not router.admin_pass_new:
        raise HTTPException(
            status_code=422,
            detail="admin_pass_new is missing. Cannot connect to router with rotated password.",
        )

    update_router_state(router_id, RouterState.DELETING)
    log_step(router_id, "cleanup", "start", "Delete requested — beginning router cleanup")

    async def run_cleanup():
        try:
            await cleanup_worker(router_id, BACKEND_WG_PUBKEY)
        except Exception as e:
            print(f"Cleanup task error for {router_id}: {e}")

    background_tasks.add_task(run_cleanup)

    return JSONResponse(
        {
            "router_id": router_id,
            "state": "DELETING",
            "status_url": f"/routers/{router_id}/status",
            "message": "Cleanup started. Poll status_url for progress.",
        },
        status_code=202,
    )


@app.get("/health")
async def health():
    """Health check."""
    return {"status": "ok"}


@app.get("/")
async def index():
    """Serve the operator UI (same-origin as the API)."""
    return FileResponse("app.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        log_level="info",
    )
