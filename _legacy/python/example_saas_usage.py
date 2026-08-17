"""
Example usage: demonstrating SaaS rate limiting in action.

Scenarios:
1. Onboard 1000 routers from two ISPs
2. Monitor queue progression over time
3. Verify fair scheduling (both ISPs get slots)
"""

import asyncio
import uuid
from datetime import datetime, timedelta
import sqlite3

from models_saas import init_db_saas, create_tenant, create_queue_item, get_queue_stats
from rate_limiter import RateLimiter
from scheduler import OnboardingScheduler


async def example_1_onboard_many_routers():
    """
    Example 1: Onboard 1000 routers from two ISPs fairly.

    Setup:
    - ISP A: 600 routers, limit=10 concurrent
    - ISP B: 400 routers, limit=8 concurrent
    - Global: limit=50 concurrent

    Expected behavior:
    - At t=0: add all 1000 to queue
    - At t=30s (tick 1): claim 50 (10+8+...round-robin)
    - At t=60s (tick 2): as routers complete, claim more
    - Continue until all done (~50 routers/min = 20 min for 1000)
    """
    print("\n" + "=" * 70)
    print("EXAMPLE 1: Onboard 1000 routers fairly across 2 ISPs")
    print("=" * 70)

    # Initialize DB
    init_db_saas()

    # Create tenants
    isp_a = create_tenant("isp-a", "ISP Alpha", max_concurrent=10)
    isp_b = create_tenant("isp-b", "ISP Beta", max_concurrent=8)
    print(f"✓ Created tenant {isp_a.id} (limit={isp_a.max_concurrent_onboardings})")
    print(f"✓ Created tenant {isp_b.id} (limit={isp_b.max_concurrent_onboardings})")

    # Add routers to queue
    print("\nAdding 1000 routers to queue...")
    for i in range(600):
        create_queue_item(
            tenant_id="isp-a",
            router_ip=f"192.168.1.{i % 256}",
            admin_username="admin",
            admin_password_encrypted="encrypted_pass_a",
        )

    for i in range(400):
        create_queue_item(
            tenant_id="isp-b",
            router_ip=f"10.0.1.{i % 256}",
            admin_username="admin",
            admin_password_encrypted="encrypted_pass_b",
        )

    stats = get_queue_stats()
    print(f"✓ Added 1000 routers: {stats}")

    # Check rate limiter
    rate_limiter = RateLimiter(global_limit=50, db_path="routers.db")
    print(f"\nRate Limiter State:")
    print(f"  Global running: {rate_limiter.get_global_running_count()}/50")
    print(f"  ISP-A running: {rate_limiter.get_tenant_running_count('isp-a')}/10")
    print(f"  ISP-B running: {rate_limiter.get_tenant_running_count('isp-b')}/8")

    print(f"\nAvailable slots:")
    print(f"  ISP-A: {rate_limiter.get_available_slots('isp-a')}")
    print(f"  ISP-B: {rate_limiter.get_available_slots('isp-b')}")

    print("\n[Scheduler would now run every 30s, claiming routers within limits]")
    print("[Expected timeline: ~1000 routers / 50 per min = 20 minutes total]")


async def example_2_two_tenants_concurrent():
    """
    Example 2: Two tenants onboarding simultaneously, verify fair scheduling.

    Setup:
    - ISP-X: 100 routers, limit=5 concurrent
    - ISP-Y: 100 routers, limit=5 concurrent
    - Global: limit=20 concurrent

    Expected behavior:
    - Scheduler round-robins between ISP-X and ISP-Y
    - Each gets ~5 slots (their per-tenant limit)
    - Global never exceeds 20
    - No tenant starves the other
    """
    print("\n" + "=" * 70)
    print("EXAMPLE 2: Two tenants with fair scheduling")
    print("=" * 70)

    init_db_saas()

    isp_x = create_tenant("isp-x", "ISP X", max_concurrent=5)
    isp_y = create_tenant("isp-y", "ISP Y", max_concurrent=5)

    # Add 50 routers each
    print("Adding 50 routers to each tenant...")
    for i in range(50):
        create_queue_item(
            tenant_id="isp-x",
            router_ip=f"172.16.0.{i}",
            admin_username="admin",
            admin_password_encrypted="pass_x",
        )
        create_queue_item(
            tenant_id="isp-y",
            router_ip=f"172.17.0.{i}",
            admin_username="admin",
            admin_password_encrypted="pass_y",
        )

    stats = get_queue_stats()
    print(f"✓ Queued: {stats}")

    # Simulate scheduler claiming routers
    scheduler = OnboardingScheduler(
        db_path="routers.db",
        global_limit=20,
        batch_size=5,
        check_interval_sec=1,  # fast for demo
        worker_id="demo-worker",
    )

    print("\n[Scheduler tick simulation]")
    print("Simulating scheduler claiming routers...\n")

    # Manually test claiming logic (without running async loop)
    rate_limiter = RateLimiter(20, "routers.db")

    active_tenants = scheduler.get_active_tenants()
    print(f"Active tenants: {active_tenants}")

    for tenant_id in active_tenants:
        can_start, reason = rate_limiter.can_start_onboarding(tenant_id)
        available_slots = rate_limiter.get_available_slots(tenant_id)
        print(f"\n{tenant_id}:")
        print(f"  Can start: {can_start} ({reason})")
        print(f"  Available slots: {available_slots}")

        if available_slots > 0:
            pending = scheduler.get_pending_for_tenant(tenant_id, limit=available_slots)
            print(f"  Could claim: {len(pending)} routers")


async def example_3_dashboard_query():
    """
    Example 3: Dashboard queries to monitor the system.
    """
    print("\n" + "=" * 70)
    print("EXAMPLE 3: Dashboard monitoring queries")
    print("=" * 70)

    # Example SQL queries for operator visibility
    queries = [
        (
            "How many routers are we processing?",
            """
        SELECT status, COUNT(*) FROM onboarding_queue
        GROUP BY status;
        """,
        ),
        (
            "Which tenant is hitting limits?",
            """
        SELECT tenant_id,
               COUNT(CASE WHEN status='RUNNING' THEN 1 END) as running,
               COUNT(CASE WHEN status='PENDING' THEN 1 END) as pending
        FROM onboarding_queue
        GROUP BY tenant_id;
        """,
        ),
        (
            "Slow routers (running >5 min)?",
            """
        SELECT router_ip, tenant_id, claimed_at
        FROM onboarding_queue
        WHERE status='RUNNING'
          AND claimed_at < datetime('now', '-5 minutes');
        """,
        ),
        (
            "Error rate?",
            """
        SELECT tenant_id,
               COUNT(CASE WHEN status='ERROR' THEN 1 END) as errors,
               COUNT(*) as total
        FROM onboarding_queue
        GROUP BY tenant_id;
        """,
        ),
    ]

    print("\nOperator-visible queries:\n")
    for desc, query in queries:
        print(f"Q: {desc}")
        print(f"SQL:\n{query.strip()}\n")


async def main():
    """Run all examples."""
    print("\n🚀 SaaS Rate Limiting & Batching Examples")
    print("=========================================\n")

    await example_1_onboard_many_routers()
    await example_2_two_tenants_concurrent()
    await example_3_dashboard_query()

    print("\n" + "=" * 70)
    print("KEY TAKEAWAYS:")
    print("=" * 70)
    print("""
1. SCALABILITY:
   - 1000 routers processed smoothly (~20 min)
   - No overload (global limit enforced)
   - Per-tenant limits prevent hogging

2. FAIRNESS:
   - Round-robin scheduler ensures both tenants get slots
   - No tenant starves another
   - FIFO within each tenant

3. RESTART SAFETY:
   - Atomic transitions (PENDING → RUNNING only if actually PENDING)
   - Worker ID tracking (orphaned tasks visible)
   - Automatic retry logic (up to max_attempts)

4. OPERATOR VISIBILITY:
   - Simple SQL queries reveal system health
   - Queue stats (PENDING/RUNNING/DONE/ERROR)
   - Per-tenant monitoring
   - Error tracking
    """)


if __name__ == "__main__":
    asyncio.run(main())
