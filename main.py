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
from fastapi.responses import JSONResponse

from models import (
    init_db,
    create_router,
    get_router,
    get_logs,
    log_step,
    get_quarantine_state,
    check_quarantine_gate,
)
from onboarding import spawn_onboarding_task
from quarantine import on_job_complete, release_quarantine

app = FastAPI(title="MikroTik Provisioning Backend", version="0.1.0")

# Global set to track active tasks (for graceful shutdown)
active_tasks = set()

# Backend's own WireGuard public key (would be generated on startup)
BACKEND_WG_PUBKEY = os.getenv(
    "BACKEND_WG_PUBKEY", "0000000000000000000000000000000000000000000"
)


class OnboardRequest(BaseModel):
    """Request to onboard a new router."""

    ip: str
    username: str
    password: str
    wg_peer_ip: Optional[str] = "10.0.0.2"  # Default WG IP for this router


class OnboardResponse(BaseModel):
    """Response to onboarding request."""

    router_id: str
    state: str
    status_url: str


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


@app.on_event("shutdown")
async def shutdown():
    """Gracefully shut down active tasks."""
    print("Shutting down...")
    for task in active_tasks:
        if not task.done():
            task.cancel()
    await asyncio.gather(*active_tasks, return_exceptions=True)
    print("✓ All tasks completed")


@app.post("/routers/onboard", response_model=OnboardResponse)
async def onboard_router(req: OnboardRequest, background_tasks: BackgroundTasks):
    """
    POST /routers/onboard
    Trigger router onboarding. Returns immediately with router_id.
    Onboarding happens asynchronously in background.
    """
    # Generate router ID
    router_id = f"{req.ip}_{uuid.uuid4().hex[:8]}"

    # Validate inputs
    if not req.ip or not req.username or not req.password:
        raise HTTPException(status_code=400, detail="Missing credentials")

    # Check quarantine gate (if router already exists, verify it's not blocked)
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

    # Create router record in DB
    try:
        create_router(
            router_id=router_id,
            ip=req.ip,
            username=req.username,
            password_encrypted=req.password,  # TODO: encrypt
            wg_ip=req.wg_peer_ip,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create router: {e}")

    # Spawn background task
    async def run_onboarding():
        try:
            task = await spawn_onboarding_task(router_id, BACKEND_WG_PUBKEY)
            active_tasks.add(task)
            await task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"Onboarding task error: {e}")
        finally:
            active_tasks.discard(task)

    # Run in background
    background_tasks.add_task(run_onboarding)

    return OnboardResponse(
        router_id=router_id,
        state="NEW",
        status_url=f"/routers/{router_id}/status",
    )


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

    # Reset to NEW and retry
    from models import update_router_state, RouterState

    update_router_state(router_id, RouterState.NEW, error=None)
    log_step(router_id, "retry", "start", "Retrying onboarding")

    # Spawn background task
    async def run_onboarding():
        try:
            task = await spawn_onboarding_task(router_id, BACKEND_WG_PUBKEY)
            active_tasks.add(task)
            await task
        except Exception as e:
            print(f"Retry task error: {e}")
        finally:
            active_tasks.discard(task)

    background_tasks.add_task(run_onboarding)

    return {"message": "Retry initiated", "router_id": router_id}


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


# @app.get("/routers/{router_id}/quarantine-history")
# async def get_router_quarantine_history(router_id: str, limit: int = 50):
#     """
#     GET /routers/{router_id}/quarantine-history
#     Get quarantine event history for a router.
#     """
#     router = get_router(router_id)
#     if not router:
#         raise HTTPException(status_code=404, detail="Router not found")
#
#     events = get_quarantine_events(router_id, limit=limit)
#     return {
#         "router_id": router_id,
#         "events": [
#             {
#                 "id": e.id,
#                 "event_type": e.event_type,
#                 "level_before": e.level_before,
#                 "level_after": e.level_after,
#                 "triggered_by": e.triggered_by,
#                 "triggered_by_id": e.triggered_by_id,
#                 "message": e.message,
#                 "created_at": e.created_at.isoformat() if e.created_at else None,
#             }
#             for e in events
#         ],
#     }


@app.get("/health")
async def health():
    """Health check."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        log_level="info",
    )
