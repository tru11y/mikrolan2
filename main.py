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

from models import init_db, create_router, get_router, get_logs, log_step
from onboarding import spawn_onboarding_task

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
