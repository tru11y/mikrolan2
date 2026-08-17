"""
Onboarding scheduler: periodically selects and starts onboarding tasks.

Fair scheduling ensures:
- No tenant starves (round-robin tenant selection)
- FIFO order within each tenant
- Respects per-tenant and global limits
- Idempotent and restart-safe
"""

import asyncio
import sqlite3
import uuid
from datetime import datetime
from typing import List, Optional

from rate_limiter import RateLimiter


class OnboardingScheduler:
    """
    Periodically selects and starts onboarding tasks.

    Attributes:
        db_path: path to SQLite database
        global_limit: max concurrent onboardings across all tenants
        batch_size: max routers to claim per scheduler tick
        check_interval_sec: how often to run scheduler (seconds)
        worker_id: identifier for this scheduler instance (e.g., hostname)
    """

    def __init__(
        self,
        db_path: str,
        global_limit: int = 50,
        batch_size: int = 10,
        check_interval_sec: int = 30,
        worker_id: str = "scheduler-1",
    ):
        self.db_path = db_path
        self.global_limit = global_limit
        self.batch_size = batch_size
        self.check_interval_sec = check_interval_sec
        self.worker_id = worker_id
        self.rate_limiter = RateLimiter(global_limit, db_path)
        self._running = False

    def _get_db(self):
        """Get DB connection."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def get_active_tenants(self) -> List[str]:
        """
        Get list of tenants that have PENDING onboardings (for fair round-robin).
        Sorted for deterministic order.
        """
        conn = self._get_db()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT DISTINCT tenant_id FROM onboarding_queue
            WHERE status = 'PENDING'
            ORDER BY tenant_id
        """
        )
        tenants = [row[0] for row in cursor.fetchall()]
        conn.close()
        return tenants

    def get_pending_for_tenant(self, tenant_id: str, limit: int = 1) -> List:
        """
        Get PENDING routers for a tenant (FIFO by created_at, high priority first).

        Returns:
            List of (id, router_ip, admin_username, admin_password_encrypted)
        """
        conn = self._get_db()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, router_ip, admin_username, admin_password_encrypted
            FROM onboarding_queue
            WHERE tenant_id = ? AND status = 'PENDING'
            ORDER BY priority DESC, created_at ASC
            LIMIT ?
        """,
            (tenant_id, limit),
        )
        rows = cursor.fetchall()
        conn.close()
        return rows

    def claim_and_run_queue_item(self, queue_id: str) -> bool:
        """
        Atomically transition queue item from PENDING → RUNNING.

        Only succeeds if the item is still PENDING (prevents race conditions).

        Args:
            queue_id: ID of queue item

        Returns:
            True if this scheduler successfully claimed it, False if already claimed
        """
        conn = self._get_db()
        cursor = conn.cursor()
        now = datetime.utcnow().isoformat()

        cursor.execute(
            """
            UPDATE onboarding_queue
            SET status = 'RUNNING',
                claimed_by_worker_id = ?,
                claimed_at = ?,
                started_at = ?
            WHERE id = ? AND status = 'PENDING'
        """,
            (self.worker_id, now, now, queue_id),
        )

        affected = cursor.rowcount
        conn.commit()
        conn.close()

        return affected > 0

    def mark_queue_done(self, queue_id: str):
        """Mark queue item as DONE."""
        conn = self._get_db()
        cursor = conn.cursor()
        now = datetime.utcnow().isoformat()
        cursor.execute(
            """
            UPDATE onboarding_queue
            SET status = 'DONE', completed_at = ?
            WHERE id = ?
        """,
            (now, queue_id),
        )
        conn.commit()
        conn.close()

    def mark_queue_error(self, queue_id: str, error: str):
        """
        Mark queue item as ERROR or PENDING (for retry).

        If attempt_count < max_attempts, resets to PENDING (will retry).
        Otherwise, marks as ERROR (permanent failure).
        """
        conn = self._get_db()
        cursor = conn.cursor()
        now = datetime.utcnow().isoformat()

        # Get current attempt count
        cursor.execute(
            """
            SELECT attempt_count, max_attempts FROM onboarding_queue WHERE id = ?
        """,
            (queue_id,),
        )
        row = cursor.fetchone()

        if row:
            attempt_count, max_attempts = row
            attempt_count += 1

            if attempt_count < max_attempts:
                # Retry: reset to PENDING
                cursor.execute(
                    """
                    UPDATE onboarding_queue
                    SET status = 'PENDING',
                        attempt_count = ?,
                        last_error = ?,
                        claimed_by_worker_id = NULL,
                        claimed_at = NULL
                    WHERE id = ?
                """,
                    (attempt_count, error, queue_id),
                )
                print(
                    f"[Queue] {queue_id}: retry attempt {attempt_count}/{max_attempts} after error: {error[:50]}..."
                )
            else:
                # Final failure
                cursor.execute(
                    """
                    UPDATE onboarding_queue
                    SET status = 'ERROR',
                        attempt_count = ?,
                        last_error = ?,
                        completed_at = ?
                    WHERE id = ?
                """,
                    (attempt_count, error, now, queue_id),
                )
                print(f"[Queue] {queue_id}: PERMANENT ERROR after {attempt_count} attempts")

        conn.commit()
        conn.close()

    async def _run_onboarding_task(
        self, queue_id: str, router_ip: str, admin_username: str, admin_password_encrypted: str
    ):
        """
        Run the actual onboarding worker for a router.
        Updates queue status when done.
        """
        try:
            # Import here to avoid circular imports
            from onboarding import onboarding_worker

            # Use existing onboarding worker (assumes router already in DB)
            # For now, we assume router_id = router_ip or derive from DB
            router_id = router_ip  # Simplification; in practice, use UUID from routers table

            backend_wg_pubkey = "1XQ53CfYH/AyDdWpTZXK0dVMdda9dqPcA3Gh1F8D4Bo="
            await onboarding_worker(router_id, backend_wg_pubkey)

            self.mark_queue_done(queue_id)
            print(f"[Onboarding] ✓ Completed {router_ip} (queue_id={queue_id[:8]}...)")

        except Exception as e:
            print(
                f"[Onboarding] ✗ Failed {router_ip} (queue_id={queue_id[:8]}...): {e}"
            )
            self.mark_queue_error(queue_id, str(e))

    async def _scheduler_tick(self):
        """
        One iteration of the scheduler.

        Algorithm:
        1. Get all tenants with PENDING routers (round-robin)
        2. For each tenant:
           a. Check if global + tenant limits allow starting
           b. Select up to N PENDING routers (FIFO)
           c. Try to claim them (atomic transition to RUNNING)
           d. Spawn asyncio tasks for claimed routers
        """
        start_time = datetime.utcnow()

        # Get tenants with pending work (ensures fair round-robin)
        active_tenants = self.get_active_tenants()
        if not active_tenants:
            return  # Nothing to do

        claimed_count = 0

        # Round-robin: each tenant gets a chance
        for tenant_id in active_tenants:
            # Check if we can start for this tenant
            can_start, reason = self.rate_limiter.can_start_onboarding(tenant_id)
            if not can_start:
                print(f"[Scheduler] Tenant {tenant_id}: {reason}")
                continue

            # How many can we start?
            available_slots = self.rate_limiter.get_available_slots(tenant_id)
            if available_slots <= 0:
                continue

            # Take minimum of: available_slots, batch_size
            can_claim = min(available_slots, self.batch_size)

            # Get pending routers for this tenant
            pending = self.get_pending_for_tenant(tenant_id, limit=can_claim)
            if not pending:
                continue

            # Try to claim each one
            for row in pending:
                queue_id = row[0]
                router_ip = row[1]
                admin_username = row[2]
                admin_password_encrypted = row[3]

                claimed = self.claim_and_run_queue_item(queue_id)
                if claimed:
                    # Spawn the actual onboarding task
                    asyncio.create_task(
                        self._run_onboarding_task(
                            queue_id, router_ip, admin_username, admin_password_encrypted
                        )
                    )
                    claimed_count += 1
                else:
                    # Someone else claimed it (race condition, fine)
                    print(f"[Scheduler] {router_ip} already claimed")

        elapsed = (datetime.utcnow() - start_time).total_seconds()
        if claimed_count > 0:
            print(
                f"[Scheduler] Tick: claimed {claimed_count} routers in {elapsed:.3f}s, "
                f"global running={self.rate_limiter.get_global_running_count()}"
            )

    async def scheduler_loop(self):
        """
        Main scheduler loop: run _scheduler_tick() every check_interval_sec seconds.

        Safe to start/stop multiple times.
        """
        self._running = True
        print(
            f"[Scheduler] Starting: global_limit={self.global_limit}, "
            f"batch_size={self.batch_size}, check_interval={self.check_interval_sec}s"
        )

        while self._running:
            try:
                await self._scheduler_tick()
            except Exception as e:
                print(f"[Scheduler] ERROR in tick: {e}")
                import traceback

                traceback.print_exc()

            await asyncio.sleep(self.check_interval_sec)

    def stop(self):
        """Stop the scheduler loop."""
        self._running = False
        print("[Scheduler] Stopping...")
