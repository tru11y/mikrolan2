"""
SaaS-ready FastAPI app with rate limiting and queuing.

Endpoints:
- POST /queue/onboard: add router to queue (non-blocking)
- GET /queue/status/{queue_id}: poll for status
- GET /queue/stats: see queue statistics
- POST /admin/tenants: create new tenant
- GET /admin/tenants/{tenant_id}: get tenant info
"""

import asyncio
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any

from models_saas import (
    init_db_saas,
    create_tenant,
    get_tenant,
    create_queue_item,
    get_queue_item,
    get_queue_stats,
)
from scheduler import OnboardingScheduler

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="MikroLan SaaS Onboarding API")
scheduler: Optional[OnboardingScheduler] = None


# ===== REQUEST/RESPONSE MODELS =====


class QueueOnboardRequest(BaseModel):
    """Request to add router to onboarding queue."""

    tenant_id: str
    router_ip: str
    admin_username: str
    admin_password_encrypted: str  # encrypted client-side or in transit
    priority: int = 0


class QueueOnboardResponse(BaseModel):
    """Response after queuing a router."""

    queue_id: str
    status: str
    message: str


class QueueStatusResponse(BaseModel):
    """Response with queue item status."""

    queue_id: str
    status: str
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    attempt_count: int = 0
    error: Optional[str] = None


class CreateTenantRequest(BaseModel):
    """Request to create a new tenant."""

    tenant_id: str
    name: str
    max_concurrent_onboardings: int = 5


class TenantResponse(BaseModel):
    """Tenant information."""

    id: str
    name: str
    max_concurrent_onboardings: int


# ===== QUEUE ENDPOINTS =====


@app.post("/queue/onboard", response_model=QueueOnboardResponse)
async def queue_onboarding(req: QueueOnboardRequest) -> QueueOnboardResponse:
    """
    Add router to onboarding queue (non-blocking).

    Instead of waiting 5-10 minutes for onboarding, clients submit routers
    to the queue and poll for status.

    Args:
        req: onboarding request with tenant, router, and credentials

    Returns:
        Queue ID for polling status

    Raises:
        404: if tenant not found
    """
    # Validate tenant exists
    tenant = get_tenant(req.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail=f"Tenant '{req.tenant_id}' not found")

    # Add to queue
    queue_item = create_queue_item(
        tenant_id=req.tenant_id,
        router_ip=req.router_ip,
        admin_username=req.admin_username,
        admin_password_encrypted=req.admin_password_encrypted,
        priority=req.priority,
    )

    logger.info(f"Queued router {req.router_ip} for tenant {req.tenant_id}")

    return QueueOnboardResponse(
        queue_id=queue_item.id,
        status="PENDING",
        message=f"Router added to queue. Check status with /queue/status/{queue_item.id}",
    )


@app.get("/queue/status/{queue_id}", response_model=QueueStatusResponse)
async def queue_status(queue_id: str) -> QueueStatusResponse:
    """
    Poll for onboarding status.

    Args:
        queue_id: ID returned from /queue/onboard

    Returns:
        Current queue item status (PENDING, RUNNING, DONE, ERROR)

    Raises:
        404: if queue_id not found
    """
    item = get_queue_item(queue_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"Queue item '{queue_id}' not found")

    return QueueStatusResponse(
        queue_id=queue_id,
        status=item.status.value,
        created_at=item.created_at.isoformat() if item.created_at else None,
        started_at=item.started_at.isoformat() if item.started_at else None,
        completed_at=item.completed_at.isoformat() if item.completed_at else None,
        attempt_count=item.attempt_count,
        error=item.last_error,
    )


@app.get("/queue/stats")
async def queue_statistics(tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Get queue statistics.

    Args:
        tenant_id: if provided, return stats for that tenant only. Otherwise global.

    Returns:
        Counts by status (PENDING, RUNNING, DONE, ERROR)
    """
    stats = get_queue_stats(tenant_id=tenant_id)
    scope = f"tenant '{tenant_id}'" if tenant_id else "global"
    return {
        "scope": scope,
        "pending": stats.get("PENDING", 0),
        "running": stats.get("RUNNING", 0),
        "done": stats.get("DONE", 0),
        "error": stats.get("ERROR", 0),
    }


# ===== ADMIN ENDPOINTS =====


@app.post("/admin/tenants", response_model=TenantResponse)
async def create_new_tenant(req: CreateTenantRequest) -> TenantResponse:
    """
    Create a new tenant (ISP/client).

    Args:
        req: tenant details

    Returns:
        Created tenant
    """
    tenant = create_tenant(
        tenant_id=req.tenant_id,
        name=req.name,
        max_concurrent=req.max_concurrent_onboardings,
    )

    logger.info(
        f"Created tenant '{req.tenant_id}' with limit {req.max_concurrent_onboardings}"
    )

    return TenantResponse(
        id=tenant.id,
        name=tenant.name,
        max_concurrent_onboardings=tenant.max_concurrent_onboardings,
    )


@app.get("/admin/tenants/{tenant_id}", response_model=TenantResponse)
async def get_tenant_info(tenant_id: str) -> TenantResponse:
    """
    Get tenant information.

    Args:
        tenant_id: tenant ID

    Returns:
        Tenant details

    Raises:
        404: if tenant not found
    """
    tenant = get_tenant(tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail=f"Tenant '{tenant_id}' not found")

    return TenantResponse(
        id=tenant.id,
        name=tenant.name,
        max_concurrent_onboardings=tenant.max_concurrent_onboardings,
    )


# ===== HEALTH & LIFECYCLE =====


@app.get("/health")
async def health() -> Dict[str, str]:
    """Health check."""
    return {"status": "ok"}


@app.on_event("startup")
async def startup_event():
    """Initialize DB and start scheduler on app startup."""
    global scheduler

    # Initialize SaaS schema
    init_db_saas()

    # Create sample tenants (for demo; remove in production)
    try:
        create_tenant("isp-demo-1", "Demo ISP #1", max_concurrent=10)
        create_tenant("isp-demo-2", "Demo ISP #2", max_concurrent=5)
        logger.info("Sample tenants created")
    except Exception:
        # Tenants may already exist
        pass

    # Start scheduler in background
    scheduler = OnboardingScheduler(
        db_path="routers.db",
        global_limit=50,  # max concurrent across all tenants
        batch_size=10,  # claim up to 10 routers per tick
        check_interval_sec=30,  # check every 30 seconds
        worker_id="uvicorn-worker-1",
    )

    asyncio.create_task(scheduler.scheduler_loop())
    logger.info("[App] Scheduler started")


@app.on_event("shutdown")
async def shutdown_event():
    """Stop scheduler on app shutdown."""
    global scheduler
    if scheduler:
        scheduler.stop()
        logger.info("[App] Scheduler stopped")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
