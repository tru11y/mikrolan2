"""
Rate limiter for multi-tenant onboarding.

Enforces:
- Global limit (max concurrent across all tenants)
- Per-tenant limit (max concurrent per ISP/tenant)
"""

import sqlite3
from typing import Tuple


class RateLimiter:
    """
    Checks if a new onboarding can start given global and per-tenant limits.
    """

    def __init__(self, global_limit: int, db_path: str):
        """
        Args:
            global_limit: max concurrent onboardings across all tenants
            db_path: path to SQLite database
        """
        self.global_limit = global_limit
        self.db_path = db_path

    def _get_db(self):
        """Get DB connection."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def get_global_running_count(self) -> int:
        """Count routers currently RUNNING across all tenants."""
        conn = self._get_db()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM onboarding_queue WHERE status = 'RUNNING'"
        )
        count = cursor.fetchone()[0]
        conn.close()
        return count

    def get_tenant_running_count(self, tenant_id: str) -> int:
        """Count routers currently RUNNING for a specific tenant."""
        conn = self._get_db()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM onboarding_queue WHERE tenant_id = ? AND status = 'RUNNING'",
            (tenant_id,),
        )
        count = cursor.fetchone()[0]
        conn.close()
        return count

    def get_tenant_limit(self, tenant_id: str) -> int:
        """Get per-tenant max concurrent onboardings."""
        conn = self._get_db()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT max_concurrent_onboardings FROM tenants WHERE id = ?",
            (tenant_id,),
        )
        row = cursor.fetchone()
        conn.close()
        return row[0] if row else 5  # default to 5

    def can_start_onboarding(self, tenant_id: str) -> Tuple[bool, str]:
        """
        Check if a new onboarding can start for a tenant.

        Returns:
            (can_start, reason) - e.g., (True, "OK") or (False, "Global limit reached")
        """
        global_count = self.get_global_running_count()
        if global_count >= self.global_limit:
            return (
                False,
                f"Global limit reached ({global_count}/{self.global_limit})",
            )

        tenant_limit = self.get_tenant_limit(tenant_id)
        tenant_count = self.get_tenant_running_count(tenant_id)
        if tenant_count >= tenant_limit:
            return (
                False,
                f"Tenant limit reached ({tenant_count}/{tenant_limit})",
            )

        return True, "OK"

    def get_available_slots(self, tenant_id: str) -> int:
        """
        Return how many onboardings can be started right now for a tenant.

        Considers both global and per-tenant limits.
        """
        global_count = self.get_global_running_count()
        global_available = max(0, self.global_limit - global_count)

        tenant_limit = self.get_tenant_limit(tenant_id)
        tenant_count = self.get_tenant_running_count(tenant_id)
        tenant_available = max(0, tenant_limit - tenant_count)

        return min(global_available, tenant_available)
