"""Database models and schema."""
from datetime import datetime
from typing import Optional, Dict, Any
from enum import Enum
import sqlite3
import os
import json

DB_PATH = os.getenv("DB_PATH", "routers.db")


class RouterState(str, Enum):
    NEW = "NEW"
    API_OK = "API_OK"
    WG_READY = "WG_READY"
    TUNNEL_UP = "TUNNEL_UP"
    LOCKED = "LOCKED"
    DONE = "DONE"
    ERROR = "ERROR"
    DELETING = "DELETING"
    DELETED = "DELETED"
    DELETE_FAILED = "DELETE_FAILED"


class QuarantineLevel(int, Enum):
    NONE = 0
    L1 = 1
    L2 = 2
    L3 = 3


class Router:
    """In-memory representation of a router row."""

    def __init__(
        self,
        id: str,
        ip: str,
        username: str,
        password_encrypted: str,
        tenant_id: Optional[str] = None,
        alias: Optional[str] = None,
        state: RouterState = RouterState.NEW,
        wg_pubkey: Optional[str] = None,
        wg_ip: Optional[str] = None,
        admin_pass_new: Optional[str] = None,
        error: Optional[str] = None,
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None,
    ):
        self.id = id
        self.ip = ip
        self.username = username
        self.password_encrypted = password_encrypted
        self.tenant_id = tenant_id
        self.alias = alias
        self.state = state
        self.wg_pubkey = wg_pubkey
        self.wg_ip = wg_ip
        self.admin_pass_new = admin_pass_new
        self.error = error
        self.created_at = created_at or datetime.utcnow()
        self.updated_at = updated_at or datetime.utcnow()

    @classmethod
    def from_row(cls, row: tuple) -> "Router":
        """Create Router from database row."""
        (
            id_,
            ip,
            username,
            password_encrypted,
            tenant_id,
            alias,
            state,
            wg_pubkey,
            wg_ip,
            admin_pass_new,
            error,
            created_at,
            updated_at,
        ) = row
        return cls(
            id=id_,
            ip=ip,
            username=username,
            password_encrypted=password_encrypted,
            tenant_id=tenant_id,
            alias=alias,
            state=RouterState(state),
            wg_pubkey=wg_pubkey,
            wg_ip=wg_ip,
            admin_pass_new=admin_pass_new,
            error=error,
            created_at=datetime.fromisoformat(created_at) if created_at else None,
            updated_at=datetime.fromisoformat(updated_at) if updated_at else None,
        )


class QuarantineState:
    """In-memory representation of quarantine state."""

    def __init__(
        self,
        id: str,
        router_id: str,
        tenant_id: str,
        level: int = 0,
        consecutive_failures: int = 0,
        triggered_by_job_id: Optional[str] = None,
        last_failure_at: Optional[datetime] = None,
        quarantined_at: Optional[datetime] = None,
        reason: Optional[str] = None,
        blocked_job_types: Optional[str] = None,
        release_reason: Optional[str] = None,
        released_at: Optional[datetime] = None,
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None,
    ):
        self.id = id
        self.router_id = router_id
        self.tenant_id = tenant_id
        self.level = level
        self.consecutive_failures = consecutive_failures
        self.triggered_by_job_id = triggered_by_job_id
        self.last_failure_at = last_failure_at
        self.quarantined_at = quarantined_at
        self.reason = reason
        self.blocked_job_types = blocked_job_types or json.dumps([])
        self.release_reason = release_reason
        self.released_at = released_at
        self.created_at = created_at or datetime.utcnow()
        self.updated_at = updated_at or datetime.utcnow()

    def as_dict(self) -> Dict[str, Any]:
        return {
            "router_id": self.router_id,
            "tenant_id": self.tenant_id,
            "quarantine_level": self.level,
            "consecutive_failures": self.consecutive_failures,
            "triggered_by_job_id": self.triggered_by_job_id,
            "last_failure_at": self.last_failure_at.isoformat() if self.last_failure_at else None,
            "quarantined_at": self.quarantined_at.isoformat() if self.quarantined_at else None,
            "reason": self.reason,
        }

    @classmethod
    def from_row(cls, row: tuple) -> "QuarantineState":
        """Create QuarantineState from database row."""
        (
            id_,
            router_id,
            tenant_id,
            level,
            consecutive_failures,
            triggered_by_job_id,
            last_failure_at,
            quarantined_at,
            reason,
            blocked_job_types,
            release_reason,
            released_at,
            created_at,
            updated_at,
        ) = row
        return cls(
            id=id_,
            router_id=router_id,
            tenant_id=tenant_id,
            level=level,
            consecutive_failures=consecutive_failures,
            triggered_by_job_id=triggered_by_job_id,
            last_failure_at=datetime.fromisoformat(last_failure_at) if last_failure_at else None,
            quarantined_at=datetime.fromisoformat(quarantined_at) if quarantined_at else None,
            reason=reason,
            blocked_job_types=blocked_job_types,
            release_reason=release_reason,
            released_at=datetime.fromisoformat(released_at) if released_at else None,
            created_at=datetime.fromisoformat(created_at) if created_at else None,
            updated_at=datetime.fromisoformat(updated_at) if updated_at else None,
        )




def init_db():
    """Initialize database schema."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Routers table
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS routers (
            id TEXT PRIMARY KEY,
            ip TEXT NOT NULL,
            username TEXT NOT NULL,
            password_encrypted TEXT NOT NULL,
            tenant_id TEXT,
            alias TEXT,
            state TEXT DEFAULT 'NEW',
            wg_pubkey TEXT,
            wg_ip TEXT,
            admin_pass_new TEXT,
            error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """
    )

    # Onboarding logs
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS onboarding_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            router_id TEXT NOT NULL,
            step TEXT NOT NULL,
            status TEXT NOT NULL,
            message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (router_id) REFERENCES routers(id)
        )
    """
    )

    # Quarantine state
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS quarantine_state (
            id TEXT PRIMARY KEY,
            router_id TEXT NOT NULL UNIQUE,
            tenant_id TEXT NOT NULL,
            level INTEGER DEFAULT 0,
            consecutive_failures INTEGER DEFAULT 0,
            triggered_by_job_id TEXT,
            last_failure_at TIMESTAMP,
            quarantined_at TIMESTAMP,
            reason TEXT,
            blocked_job_types TEXT,
            release_reason TEXT,
            released_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (router_id) REFERENCES routers(id),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        )
    """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_quarantine_router_id ON quarantine_state(router_id)")

    # Migrate: add alias column if not present
    try:
        cursor.execute("ALTER TABLE routers ADD COLUMN alias TEXT")
    except Exception:
        pass  # column already exists
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_quarantine_tenant_id ON quarantine_state(tenant_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_quarantine_level ON quarantine_state(level)")


    conn.commit()
    conn.close()


def get_router(router_id: str) -> Optional[Router]:
    """Fetch router by ID."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, ip, username, password_encrypted, tenant_id, alias, state, wg_pubkey, wg_ip,
               admin_pass_new, error, created_at, updated_at
        FROM routers WHERE id = ?
    """,
        (router_id,),
    )
    row = cursor.fetchone()
    conn.close()
    return Router.from_row(row) if row else None


def list_routers() -> list:
    """Return summary of all routers ordered by creation date desc."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, ip, alias, state, wg_ip, error, created_at, updated_at
        FROM routers WHERE state != 'DELETED' ORDER BY created_at DESC
        """
    )
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "id": r[0], "ip": r[1], "alias": r[2], "state": r[3],
            "wg_ip": r[4], "error": r[5],
            "created_at": r[6], "updated_at": r[7],
        }
        for r in rows
    ]


def create_router(
    router_id: str,
    ip: str,
    username: str,
    password_encrypted: str,
    wg_ip: str,
    tenant_id: Optional[str] = None,
    alias: Optional[str] = None,
) -> Router:
    """Create new router record."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute(
        """
        INSERT INTO routers (id, ip, username, password_encrypted, tenant_id, alias, state, wg_ip, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (router_id, ip, username, password_encrypted, tenant_id, alias, "NEW", wg_ip, now, now),
    )
    conn.commit()
    conn.close()
    return Router(
        id=router_id,
        ip=ip,
        username=username,
        password_encrypted=password_encrypted,
        tenant_id=tenant_id,
        alias=alias,
        wg_ip=wg_ip,
    )


def update_router_state(
    router_id: str, new_state: RouterState, error: Optional[str] = None
) -> bool:
    """Update router state. Returns True if update succeeded (1 row affected)."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute(
        """
        UPDATE routers SET state = ?, error = ?, updated_at = ? WHERE id = ?
    """,
        (new_state.value, error, now, router_id),
    )
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def update_router_wg_pubkey(router_id: str, wg_pubkey: str) -> bool:
    """Store retrieved WireGuard public key."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute(
        """
        UPDATE routers SET wg_pubkey = ?, updated_at = ? WHERE id = ?
    """,
        (wg_pubkey, now, router_id),
    )
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def update_router_admin_password(router_id: str, new_pass: str) -> bool:
    """Store new admin password (encrypted)."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute(
        """
        UPDATE routers SET admin_pass_new = ?, updated_at = ? WHERE id = ?
    """,
        (new_pass, now, router_id),
    )
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def log_step(
    router_id: str, step: str, status: str, message: Optional[str] = None
):
    """Log onboarding step."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO onboarding_logs (router_id, step, status, message)
        VALUES (?, ?, ?, ?)
    """,
        (router_id, step, status, message),
    )
    conn.commit()
    conn.close()


def get_logs(router_id: str) -> list:
    """Fetch all logs for a router."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT step, status, message, created_at FROM onboarding_logs
        WHERE router_id = ? ORDER BY created_at
    """,
        (router_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return [
        {"step": r[0], "status": r[1], "message": r[2], "at": r[3]} for r in rows
    ]


# Quarantine functions

def get_or_create_quarantine_state(router_id: str, tenant_id: str) -> QuarantineState:
    """Get quarantine state or create with defaults."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT id, router_id, tenant_id, level, consecutive_failures, triggered_by_job_id,
               last_failure_at, quarantined_at, reason, blocked_job_types, release_reason,
               released_at, created_at, updated_at
        FROM quarantine_state WHERE router_id = ?
    """,
        (router_id,),
    )
    row = cursor.fetchone()

    if row:
        conn.close()
        return QuarantineState.from_row(row)

    # Create new quarantine state with defaults
    quarantine_id = f"quarantine_state:{router_id}"
    now = datetime.utcnow().isoformat()
    cursor.execute(
        """
        INSERT INTO quarantine_state
        (id, router_id, tenant_id, level, consecutive_failures, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """,
        (quarantine_id, router_id, tenant_id, 0, 0, now, now),
    )
    conn.commit()
    conn.close()

    return QuarantineState(
        id=quarantine_id,
        router_id=router_id,
        tenant_id=tenant_id,
    )


def update_quarantine_state(
    router_id: str,
    level: Optional[int] = None,
    consecutive_failures: Optional[int] = None,
    triggered_by_job_id: Optional[str] = None,
    last_failure_at: Optional[datetime] = None,
    quarantined_at: Optional[datetime] = None,
    reason: Optional[str] = None,
    release_reason: Optional[str] = None,
    released_at: Optional[datetime] = None,
) -> bool:
    """Update quarantine state. Returns True if succeeded."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()

    updates = ["updated_at = ?"]
    params = [now]

    if level is not None:
        updates.append("level = ?")
        params.append(level)
    if consecutive_failures is not None:
        updates.append("consecutive_failures = ?")
        params.append(consecutive_failures)
    if triggered_by_job_id is not None:
        updates.append("triggered_by_job_id = ?")
        params.append(triggered_by_job_id)
    if last_failure_at is not None:
        updates.append("last_failure_at = ?")
        params.append(last_failure_at.isoformat() if isinstance(last_failure_at, datetime) else last_failure_at)
    if quarantined_at is not None:
        updates.append("quarantined_at = ?")
        params.append(quarantined_at.isoformat() if isinstance(quarantined_at, datetime) else quarantined_at)
    if reason is not None:
        updates.append("reason = ?")
        params.append(reason)
    if release_reason is not None:
        updates.append("release_reason = ?")
        params.append(release_reason)
    if released_at is not None:
        updates.append("released_at = ?")
        params.append(released_at.isoformat() if isinstance(released_at, datetime) else released_at)

    params.append(router_id)

    query = f"UPDATE quarantine_state SET {', '.join(updates)} WHERE router_id = ?"
    cursor.execute(query, params)
    affected = cursor.rowcount
    conn.commit()
    conn.close()

    return affected > 0


def get_quarantine_state(router_id: str) -> Optional[QuarantineState]:
    """Fetch quarantine state by router ID."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, router_id, tenant_id, level, consecutive_failures, triggered_by_job_id,
               last_failure_at, quarantined_at, reason, blocked_job_types, release_reason,
               released_at, created_at, updated_at
        FROM quarantine_state WHERE router_id = ?
    """,
        (router_id,),
    )
    row = cursor.fetchone()
    conn.close()
    return QuarantineState.from_row(row) if row else None


def allocate_wg_ip() -> str:
    """Allocate the next unused WG IP from the pool 10.0.0.2–10.0.0.254."""
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT wg_ip FROM routers WHERE wg_ip IS NOT NULL")
        used = {row[0].split("/")[0] for row in cursor.fetchall() if row[0]}
        for i in range(2, 255):
            candidate = f"10.0.0.{i}"
            if candidate not in used:
                return f"{candidate}/32"
        raise RuntimeError("WG IP pool exhausted (10.0.0.2–10.0.0.254 all in use)")
    finally:
        conn.close()


def delete_router_data(router_id: str) -> None:
    """
    Remove onboarding logs and quarantine state for a router.
    The router row itself is kept as a DELETED tombstone so the status endpoint
    can return state=DELETED after cleanup completes.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM onboarding_logs WHERE router_id = ?", (router_id,))
    cursor.execute("DELETE FROM quarantine_state WHERE router_id = ?", (router_id,))
    conn.commit()
    conn.close()


def clear_router_secrets(router_id: str) -> bool:
    """
    Zero out credential columns immediately after successful cleanup.
    Must be called only after all router-side steps confirm success.
    password_encrypted and admin_pass_new are NULLed; the router row is kept
    as a DELETED tombstone for audit purposes.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute(
        "UPDATE routers SET password_encrypted = NULL, admin_pass_new = NULL, updated_at = ? WHERE id = ?",
        (now, router_id),
    )
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0



