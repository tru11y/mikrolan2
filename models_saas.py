"""
Extended database models and schema for multi-tenant SaaS onboarding.

Adds:
- Tenants table (ISP/client management)
- Onboarding queue table (PENDING/RUNNING/DONE/ERROR states)
- Indexes for performance

Existing tables (from models.py):
- routers (updated with tenant_id)
- onboarding_logs
"""

from datetime import datetime
from typing import Optional
from enum import Enum
import sqlite3
import os

DB_PATH = os.getenv("DB_PATH", "routers.db")


class QueueStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    DONE = "DONE"
    ERROR = "ERROR"


class OnboardingQueueItem:
    """In-memory representation of an onboarding queue item."""

    def __init__(
        self,
        id: str,
        tenant_id: str,
        router_ip: str,
        admin_username: str,
        admin_password_encrypted: str,
        status: QueueStatus = QueueStatus.PENDING,
        priority: int = 0,
        attempt_count: int = 0,
        max_attempts: int = 3,
        last_error: Optional[str] = None,
        created_at: Optional[datetime] = None,
        started_at: Optional[datetime] = None,
        completed_at: Optional[datetime] = None,
        claimed_by_worker_id: Optional[str] = None,
        claimed_at: Optional[datetime] = None,
    ):
        self.id = id
        self.tenant_id = tenant_id
        self.router_ip = router_ip
        self.admin_username = admin_username
        self.admin_password_encrypted = admin_password_encrypted
        self.status = status
        self.priority = priority
        self.attempt_count = attempt_count
        self.max_attempts = max_attempts
        self.last_error = last_error
        self.created_at = created_at or datetime.utcnow()
        self.started_at = started_at
        self.completed_at = completed_at
        self.claimed_by_worker_id = claimed_by_worker_id
        self.claimed_at = claimed_at

    @classmethod
    def from_row(cls, row: tuple) -> "OnboardingQueueItem":
        """Create from database row."""
        (
            id_,
            tenant_id,
            router_ip,
            admin_username,
            admin_password_encrypted,
            status,
            priority,
            attempt_count,
            max_attempts,
            last_error,
            created_at,
            started_at,
            completed_at,
            claimed_by_worker_id,
            claimed_at,
        ) = row
        return cls(
            id=id_,
            tenant_id=tenant_id,
            router_ip=router_ip,
            admin_username=admin_username,
            admin_password_encrypted=admin_password_encrypted,
            status=QueueStatus(status),
            priority=priority,
            attempt_count=attempt_count,
            max_attempts=max_attempts,
            last_error=last_error,
            created_at=datetime.fromisoformat(created_at) if created_at else None,
            started_at=datetime.fromisoformat(started_at) if started_at else None,
            completed_at=datetime.fromisoformat(completed_at) if completed_at else None,
            claimed_by_worker_id=claimed_by_worker_id,
            claimed_at=datetime.fromisoformat(claimed_at) if claimed_at else None,
        )


class Tenant:
    """In-memory representation of a tenant (ISP/client)."""

    def __init__(
        self,
        id: str,
        name: str,
        max_concurrent_onboardings: int = 5,
        created_at: Optional[datetime] = None,
    ):
        self.id = id
        self.name = name
        self.max_concurrent_onboardings = max_concurrent_onboardings
        self.created_at = created_at or datetime.utcnow()

    @classmethod
    def from_row(cls, row: tuple) -> "Tenant":
        """Create from database row."""
        id_, name, max_concurrent, created_at = row
        return cls(
            id=id_,
            name=name,
            max_concurrent_onboardings=max_concurrent,
            created_at=datetime.fromisoformat(created_at) if created_at else None,
        )


def init_db_saas():
    """Initialize SaaS database schema (extends existing models.py schema)."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # ===== NEW TABLES =====

    # Tenants table
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS tenants (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            max_concurrent_onboardings INT DEFAULT 5,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """
    )

    # Onboarding queue
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS onboarding_queue (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            router_ip TEXT NOT NULL,
            admin_username TEXT NOT NULL,
            admin_password_encrypted TEXT NOT NULL,

            status TEXT DEFAULT 'PENDING',
            priority INT DEFAULT 0,
            attempt_count INT DEFAULT 0,
            max_attempts INT DEFAULT 3,
            last_error TEXT,

            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            claimed_by_worker_id TEXT,
            claimed_at TIMESTAMP,

            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        )
    """
    )

    # ===== INDEXES =====
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_queue_status ON onboarding_queue(status)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_queue_tenant_status ON onboarding_queue(tenant_id, status)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_queue_claimed ON onboarding_queue(claimed_by_worker_id, status)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_queue_priority ON onboarding_queue(priority DESC, created_at ASC)"
    )

    # ===== ALTER EXISTING routers TABLE =====
    # (Add tenant_id if it doesn't exist)
    cursor.execute("PRAGMA table_info(routers)")
    columns = [col[1] for col in cursor.fetchall()]
    if "tenant_id" not in columns:
        cursor.execute(
            "ALTER TABLE routers ADD COLUMN tenant_id TEXT"
        )
        cursor.execute(
            "ALTER TABLE routers ADD FOREIGN KEY (tenant_id) REFERENCES tenants(id)"
        )

    conn.commit()
    conn.close()
    print("[DB] SaaS schema initialized")


def create_tenant(tenant_id: str, name: str, max_concurrent: int = 5) -> Tenant:
    """Create a new tenant."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()

    cursor.execute(
        """
        INSERT INTO tenants (id, name, max_concurrent_onboardings, created_at)
        VALUES (?, ?, ?, ?)
    """,
        (tenant_id, name, max_concurrent, now),
    )

    conn.commit()
    conn.close()

    return Tenant(id=tenant_id, name=name, max_concurrent_onboardings=max_concurrent)


def get_tenant(tenant_id: str) -> Optional[Tenant]:
    """Fetch tenant by ID."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, max_concurrent_onboardings, created_at FROM tenants WHERE id = ?", (tenant_id,))
    row = cursor.fetchone()
    conn.close()
    return Tenant.from_row(row) if row else None


def create_queue_item(
    tenant_id: str,
    router_ip: str,
    admin_username: str,
    admin_password_encrypted: str,
    priority: int = 0,
) -> OnboardingQueueItem:
    """Add router to onboarding queue."""
    import uuid

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    queue_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    cursor.execute(
        """
        INSERT INTO onboarding_queue
        (id, tenant_id, router_ip, admin_username, admin_password_encrypted, status, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            queue_id,
            tenant_id,
            router_ip,
            admin_username,
            admin_password_encrypted,
            "PENDING",
            priority,
            now,
        ),
    )

    conn.commit()
    conn.close()

    return OnboardingQueueItem(
        id=queue_id,
        tenant_id=tenant_id,
        router_ip=router_ip,
        admin_username=admin_username,
        admin_password_encrypted=admin_password_encrypted,
        priority=priority,
    )


def get_queue_item(queue_id: str) -> Optional[OnboardingQueueItem]:
    """Fetch queue item by ID."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, tenant_id, router_ip, admin_username, admin_password_encrypted,
               status, priority, attempt_count, max_attempts, last_error,
               created_at, started_at, completed_at, claimed_by_worker_id, claimed_at
        FROM onboarding_queue WHERE id = ?
    """,
        (queue_id,),
    )
    row = cursor.fetchone()
    conn.close()
    return OnboardingQueueItem.from_row(row) if row else None


def get_queue_stats(tenant_id: Optional[str] = None) -> dict:
    """Get queue statistics. If tenant_id is None, get global stats."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    if tenant_id:
        cursor.execute(
            """
            SELECT status, COUNT(*) as count FROM onboarding_queue
            WHERE tenant_id = ?
            GROUP BY status
        """,
            (tenant_id,),
        )
    else:
        cursor.execute(
            """
            SELECT status, COUNT(*) as count FROM onboarding_queue
            GROUP BY status
        """
        )

    stats = {row[0]: row[1] for row in cursor.fetchall()}
    conn.close()
    return stats
