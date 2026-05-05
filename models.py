"""Database models and schema."""
from datetime import datetime
from typing import Optional
from enum import Enum
import sqlite3
import os

DB_PATH = os.getenv("DB_PATH", "routers.db")


class RouterState(str, Enum):
    NEW = "NEW"
    API_OK = "API_OK"
    WG_READY = "WG_READY"
    TUNNEL_UP = "TUNNEL_UP"
    LOCKED = "LOCKED"
    DONE = "DONE"
    ERROR = "ERROR"


class Router:
    """In-memory representation of a router row."""

    def __init__(
        self,
        id: str,
        ip: str,
        username: str,
        password_encrypted: str,
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
            state=RouterState(state),
            wg_pubkey=wg_pubkey,
            wg_ip=wg_ip,
            admin_pass_new=admin_pass_new,
            error=error,
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

    conn.commit()
    conn.close()


def get_router(router_id: str) -> Optional[Router]:
    """Fetch router by ID."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, ip, username, password_encrypted, state, wg_pubkey, wg_ip,
               admin_pass_new, error, created_at, updated_at
        FROM routers WHERE id = ?
    """,
        (router_id,),
    )
    row = cursor.fetchone()
    conn.close()
    return Router.from_row(row) if row else None


def create_router(
    router_id: str,
    ip: str,
    username: str,
    password_encrypted: str,
    wg_ip: str,
) -> Router:
    """Create new router record."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute(
        """
        INSERT INTO routers (id, ip, username, password_encrypted, state, wg_ip, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (router_id, ip, username, password_encrypted, "NEW", wg_ip, now, now),
    )
    conn.commit()
    conn.close()
    return Router(
        id=router_id,
        ip=ip,
        username=username,
        password_encrypted=password_encrypted,
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
