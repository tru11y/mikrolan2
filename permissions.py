"""Per-router user permissions and audit logging. Purely additive module."""
from datetime import datetime
from typing import Optional
import sqlite3

from models import DB_PATH


class RouterPermission:
    def __init__(
        self,
        user_id: str,
        router_id: str,
        can_view: bool = True,
        can_remote_read: bool = True,
        can_remote_action: bool = True,
        can_reboot: bool = True,
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None,
    ):
        self.user_id = user_id
        self.router_id = router_id
        self.can_view = can_view
        self.can_remote_read = can_remote_read
        self.can_remote_action = can_remote_action
        self.can_reboot = can_reboot
        self.created_at = created_at or datetime.utcnow()
        self.updated_at = updated_at or datetime.utcnow()

    def as_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "router_id": self.router_id,
            "can_view": self.can_view,
            "can_remote_read": self.can_remote_read,
            "can_remote_action": self.can_remote_action,
            "can_reboot": self.can_reboot,
        }

    @classmethod
    def allow_all(cls, user_id: str, router_id: str) -> "RouterPermission":
        """Default when no explicit record exists — backwards-compatible open access."""
        return cls(user_id=user_id, router_id=router_id,
                   can_view=True, can_remote_read=True,
                   can_remote_action=True, can_reboot=True)

    @classmethod
    def from_row(cls, row: tuple) -> "RouterPermission":
        user_id, router_id, can_view, can_remote_read, can_remote_action, can_reboot, created_at, updated_at = row
        return cls(
            user_id=user_id,
            router_id=router_id,
            can_view=bool(can_view),
            can_remote_read=bool(can_remote_read),
            can_remote_action=bool(can_remote_action),
            can_reboot=bool(can_reboot),
            created_at=datetime.fromisoformat(created_at) if created_at else None,
            updated_at=datetime.fromisoformat(updated_at) if updated_at else None,
        )


def init_permissions_tables():
    """Create router_permissions and audit_logs tables if they don't exist."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS router_permissions (
            user_id TEXT NOT NULL,
            router_id TEXT NOT NULL,
            can_view INTEGER DEFAULT 1,
            can_remote_read INTEGER DEFAULT 1,
            can_remote_action INTEGER DEFAULT 1,
            can_reboot INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, router_id)
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            router_id TEXT NOT NULL,
            action TEXT NOT NULL,
            success INTEGER NOT NULL,
            detail TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_router ON audit_logs(router_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_perm_router ON router_permissions(router_id)")
    conn.commit()
    conn.close()


def get_permission(user_id: str, router_id: str) -> RouterPermission:
    """Return the permission record for (user_id, router_id).
    Falls back to allow-all when no record exists (backwards-compatible)."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT user_id, router_id, can_view, can_remote_read, can_remote_action, can_reboot, "
        "created_at, updated_at FROM router_permissions WHERE user_id = ? AND router_id = ?",
        (user_id, router_id),
    )
    row = cursor.fetchone()
    conn.close()
    return RouterPermission.from_row(row) if row else RouterPermission.allow_all(user_id, router_id)


def set_permission(
    user_id: str,
    router_id: str,
    can_view: bool = True,
    can_remote_read: bool = True,
    can_remote_action: bool = True,
    can_reboot: bool = True,
) -> bool:
    """Upsert permission flags for (user_id, router_id)."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute(
        """
        INSERT INTO router_permissions
            (user_id, router_id, can_view, can_remote_read, can_remote_action, can_reboot, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, router_id) DO UPDATE SET
            can_view = excluded.can_view,
            can_remote_read = excluded.can_remote_read,
            can_remote_action = excluded.can_remote_action,
            can_reboot = excluded.can_reboot,
            updated_at = excluded.updated_at
        """,
        (user_id, router_id, int(can_view), int(can_remote_read), int(can_remote_action), int(can_reboot), now, now),
    )
    conn.commit()
    conn.close()
    return True


def log_audit(user_id: str, router_id: str, action: str, success: bool, detail: str = ""):
    """Write an immutable audit entry. Never raises — failures are swallowed."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO audit_logs (user_id, router_id, action, success, detail) VALUES (?, ?, ?, ?, ?)",
            (user_id, router_id, action, int(success), detail),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def get_audit_logs(
    router_id: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 100,
) -> list:
    """Fetch audit entries, newest first. Filter by router_id and/or user_id."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    conditions, params = [], []
    if router_id:
        conditions.append("router_id = ?")
        params.append(router_id)
    if user_id:
        conditions.append("user_id = ?")
        params.append(user_id)
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.append(limit)
    cursor.execute(
        f"SELECT id, user_id, router_id, action, success, detail, created_at "
        f"FROM audit_logs {where} ORDER BY created_at DESC LIMIT ?",
        params,
    )
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "id": r[0], "user_id": r[1], "router_id": r[2],
            "action": r[3], "success": bool(r[4]), "detail": r[5], "created_at": r[6],
        }
        for r in rows
    ]
