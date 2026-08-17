"""Quarantine system hooks and state transitions."""
from datetime import datetime
from typing import Optional, Tuple
from models import (
    get_or_create_quarantine_state,
    get_quarantine_state,
    update_quarantine_state,
    get_router,
)


async def on_job_complete(job_id: str, status: str, router_id: str) -> None:
    """
    Called after job succeeds or fails.
    Updates quarantine state based on job outcome.
    """
    router = get_router(router_id)
    if not router or not router.tenant_id:
        return

    quarantine = get_or_create_quarantine_state(router_id, router.tenant_id)

    if status == "success":
        # Reset consecutive failures if count > 0
        if quarantine.consecutive_failures > 0:
            update_quarantine_state(
                router_id=router_id,
                consecutive_failures=0,
                last_failure_at=None,
            )

    elif status == "failed":
        # Increment failure counter
        new_count = quarantine.consecutive_failures + 1
        update_quarantine_state(
            router_id=router_id,
            consecutive_failures=new_count,
            last_failure_at=datetime.utcnow(),
            triggered_by_job_id=job_id,
        )

        # Check entry conditions
        if new_count == 2 and quarantine.level == 0:
            await enter_quarantine_l1(router_id, router.tenant_id, job_id)
        elif new_count == 3 and quarantine.level == 1:
            await escalate_to_l2(router_id, router.tenant_id, job_id)
        elif new_count >= 4 and quarantine.level == 2:
            await escalate_to_l3(router_id, router.tenant_id, job_id)


async def enter_quarantine_l1(router_id: str, tenant_id: str, job_id: str) -> None:
    """Enter quarantine L1 on 2 consecutive failures."""
    quarantine = get_quarantine_state(router_id)
    if not quarantine:
        return

    now = datetime.utcnow()
    update_quarantine_state(
        router_id=router_id,
        level=1,
        quarantined_at=now,
        reason="2 consecutive job failures",
    )


async def escalate_to_l2(router_id: str, tenant_id: str, job_id: str) -> None:
    """Escalate to quarantine L2 on 3 consecutive failures."""
    quarantine = get_quarantine_state(router_id)
    if not quarantine:
        return

    update_quarantine_state(
        router_id=router_id,
        level=2,
        reason="3 consecutive job failures",
    )


async def escalate_to_l3(router_id: str, tenant_id: str, job_id: str) -> None:
    """Escalate to quarantine L3 on 4+ consecutive failures."""
    quarantine = get_quarantine_state(router_id)
    if not quarantine:
        return

    update_quarantine_state(
        router_id=router_id,
        level=3,
        reason="4+ consecutive job failures",
    )


async def release_quarantine(
    router_id: str,
    tenant_id: str,
    reason: str,
) -> bool:
    """
    Release router from quarantine to L0.
    Returns True if successful.
    """
    quarantine = get_quarantine_state(router_id)
    if not quarantine or quarantine.level == 0:
        return False

    if len(reason) < 10:
        return False  # Reason too short

    level_before = quarantine.level
    now = datetime.utcnow()

    update_quarantine_state(
        router_id=router_id,
        level=0,
        consecutive_failures=0,
        release_reason=reason,
        released_at=now,
    )

    return True


def check_quarantine_gate(router_id: str, job_type: str) -> Tuple[bool, Optional[str]]:
    """
    Check if a job is allowed based on quarantine level.

    L0: all jobs allowed
    L1: verify allowed; apply/rollback blocked
    L2/L3: all jobs blocked

    Returns: (allowed, reason)
    """
    quarantine = get_quarantine_state(router_id)

    if not quarantine or quarantine.level == 0:
        return True, None

    if quarantine.level == 1:
        if job_type in ("apply", "rollback"):
            return False, f"L1 quarantine blocks {job_type} operations"
        return True, None

    if quarantine.level in (2, 3):
        return False, f"L{quarantine.level} quarantine blocks all operations"

    return True, None
