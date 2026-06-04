"""
Advanced access sessions — ephemeral, time-boxed VPS port forwarding to router services.

Security model
──────────────
- Caller must hold can_remote_action AND can_reboot on the router (enforced in
  the router layer; checked here for defence-in-depth on create_session).
- Router must be in TUNNEL_UP or DONE state.
- Access is strictly time-boxed (1 s – MAX_DURATION_SECONDS, default 5 min).
- The VPS opens a single iptables PREROUTING DNAT rule:
    VPS:allocated_port  →  router_wg_ip:service_port  (via WireGuard tunnel)
  No rule is added that points at the public internet; the router is never
  directly reachable without the tunnel.
- On expiry or explicit DELETE the rule is removed immediately (best-effort).
  The DB record is marked expired/revoked regardless of iptables success so the
  port is freed and no orphan sessions linger in "active" state.
- All create / teardown events are written to audit_logs.

Prerequisites on the VPS (one-time setup, NOT managed here)
───────────────────────────────────────────────────────────
    sysctl -w net.ipv4.ip_forward=1
    iptables -A FORWARD -i wg0 -j ACCEPT
    iptables -A FORWARD -o wg0 -j ACCEPT
    iptables -t nat -A POSTROUTING -s 10.0.0.0/24 -j MASQUERADE

These are broad WireGuard forwarding rules and are not touched by this module.
"""
import asyncio
import os
import random
import sqlite3
import subprocess
import uuid
from datetime import datetime, timedelta
from typing import Optional

from models import DB_PATH, RouterState, get_router
from permissions import get_permission, log_audit

# ── Constants ──────────────────────────────────────────────────────────────────

SERVICE_PORTS: dict = {
    "webfig":     80,
    "webfig-ssl": 443,
    "winbox":     8291,
    "ssh":        22,
}

ALLOCATED_PORT_MIN = 40000
ALLOCATED_PORT_MAX = 49999

MAX_DURATION_SECONDS: int = int(os.getenv("ADVANCED_ACCESS_MAX_DURATION", "3600"))
DEFAULT_DURATION_SECONDS: int = int(os.getenv("ADVANCED_ACCESS_DEFAULT_DURATION", "300"))

_ALLOWED_STATES = {RouterState.TUNNEL_UP, RouterState.DONE}
_CLEANUP_INTERVAL_SECONDS = 60


# ── DB initialisation ──────────────────────────────────────────────────────────

def init_advanced_access_tables() -> None:
    """Create advanced_access_sessions table if it does not exist (idempotent)."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS advanced_access_sessions (
            id              TEXT    PRIMARY KEY,
            router_id       TEXT    NOT NULL,
            user_id         TEXT    NOT NULL,
            service         TEXT    NOT NULL,
            service_port    INTEGER NOT NULL,
            allocated_port  INTEGER NOT NULL,
            router_wg_ip    TEXT    NOT NULL,
            expires_at      TIMESTAMP NOT NULL,
            status          TEXT    DEFAULT 'active',
            teardown_at     TIMESTAMP,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Partial unique index so two active sessions cannot share a port;
    # expired/revoked records are allowed to repeat ports over time.
    cursor.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_adv_active_port "
        "ON advanced_access_sessions(allocated_port) WHERE status = 'active'"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_adv_router "
        "ON advanced_access_sessions(router_id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_adv_status "
        "ON advanced_access_sessions(status)"
    )
    conn.commit()
    conn.close()


# ── Data class ─────────────────────────────────────────────────────────────────

class AdvancedAccessSession:
    def __init__(
        self,
        id: str,
        router_id: str,
        user_id: str,
        service: str,
        service_port: int,
        allocated_port: int,
        router_wg_ip: str,
        expires_at: datetime,
        status: str,
        teardown_at: Optional[datetime],
        created_at: Optional[datetime] = None,
    ):
        self.id = id
        self.router_id = router_id
        self.user_id = user_id
        self.service = service
        self.service_port = service_port
        self.allocated_port = allocated_port
        self.router_wg_ip = router_wg_ip
        self.expires_at = expires_at
        self.status = status
        self.teardown_at = teardown_at
        self.created_at = created_at or datetime.utcnow()

    def is_expired(self) -> bool:
        return datetime.utcnow() >= self.expires_at

    def effective_status(self) -> str:
        """Return 'expired' if active but past deadline (DB not yet swept)."""
        if self.status == "active" and self.is_expired():
            return "expired"
        return self.status

    def as_dict(self) -> dict:
        return {
            "access_id":      self.id,
            "router_id":      self.router_id,
            "user_id":        self.user_id,
            "service":        self.service,
            "service_port":   self.service_port,
            "allocated_port": self.allocated_port,
            "expires_at":     self.expires_at.isoformat(),
            "status":         self.effective_status(),
            "teardown_at":    self.teardown_at.isoformat() if self.teardown_at else None,
            "created_at":     self.created_at.isoformat() if self.created_at else None,
        }

    @classmethod
    def from_row(cls, row: tuple) -> "AdvancedAccessSession":
        (id_, router_id, user_id, service, service_port, allocated_port,
         router_wg_ip, expires_at, status, teardown_at, created_at) = row
        return cls(
            id=id_,
            router_id=router_id,
            user_id=user_id,
            service=service,
            service_port=service_port,
            allocated_port=allocated_port,
            router_wg_ip=router_wg_ip,
            expires_at=datetime.fromisoformat(expires_at),
            status=status,
            teardown_at=datetime.fromisoformat(teardown_at) if teardown_at else None,
            created_at=datetime.fromisoformat(created_at) if created_at else None,
        )


# ── Port allocation ────────────────────────────────────────────────────────────

def _allocate_port() -> Optional[int]:
    """
    Pick a random unused port from ALLOCATED_PORT_MIN–ALLOCATED_PORT_MAX.
    Reads the set of currently active ports from the DB (no lock needed:
    SQLite + the unique partial index enforce uniqueness at INSERT time).
    Returns None when the pool is exhausted.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT allocated_port FROM advanced_access_sessions WHERE status = 'active'"
    )
    used = {row[0] for row in cursor.fetchall()}
    conn.close()

    pool = list(range(ALLOCATED_PORT_MIN, ALLOCATED_PORT_MAX + 1))
    random.shuffle(pool)
    for port in pool:
        if port not in used:
            return port
    return None


# ── iptables helpers ───────────────────────────────────────────────────────────

def _wg_host(wg_ip: str) -> str:
    return wg_ip.split("/")[0]


def _iptables_add(allocated_port: int, router_wg_ip: str, service_port: int) -> bool:
    """
    Insert a PREROUTING DNAT rule:
        tcp dport allocated_port  →  DNAT router_wg_ip:service_port
    Returns True on success.  Fails closed: caller must not persist the session
    if this returns False.
    """
    host = _wg_host(router_wg_ip)
    cmd = [
        "iptables", "-t", "nat", "-A", "PREROUTING",
        "-p", "tcp", "--dport", str(allocated_port),
        "-j", "DNAT", "--to-destination", f"{host}:{service_port}",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=10)
        if result.returncode != 0:
            print(f"[advanced_access] iptables add failed: {result.stderr.decode().strip()}")
            return False
        return True
    except Exception as e:
        print(f"[advanced_access] iptables add exception: {e}")
        return False


def _iptables_remove(allocated_port: int, router_wg_ip: str, service_port: int) -> None:
    """
    Delete the PREROUTING DNAT rule.  Idempotent: iptables -D returns exit 1
    when the rule is absent; we ignore that so repeated calls are safe.
    """
    host = _wg_host(router_wg_ip)
    cmd = [
        "iptables", "-t", "nat", "-D", "PREROUTING",
        "-p", "tcp", "--dport", str(allocated_port),
        "-j", "DNAT", "--to-destination", f"{host}:{service_port}",
    ]
    try:
        subprocess.run(cmd, capture_output=True, timeout=10)
        # returncode deliberately not checked — rule missing = already clean
    except Exception as e:
        print(f"[advanced_access] iptables remove exception (non-fatal): {e}")


# ── DB persistence ─────────────────────────────────────────────────────────────

def _save_session(s: AdvancedAccessSession) -> None:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO advanced_access_sessions
            (id, router_id, user_id, service, service_port, allocated_port,
             router_wg_ip, expires_at, status, teardown_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            s.id, s.router_id, s.user_id, s.service, s.service_port,
            s.allocated_port, s.router_wg_ip, s.expires_at.isoformat(),
            s.status,
            s.teardown_at.isoformat() if s.teardown_at else None,
            s.created_at.isoformat(),
        ),
    )
    conn.commit()
    conn.close()


def _mark_status(session_id: str, status: str) -> None:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute(
        "UPDATE advanced_access_sessions SET status = ?, teardown_at = ? WHERE id = ?",
        (status, now, session_id),
    )
    conn.commit()
    conn.close()


def get_session(session_id: str) -> Optional[AdvancedAccessSession]:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, router_id, user_id, service, service_port, allocated_port,
               router_wg_ip, expires_at, status, teardown_at, created_at
        FROM advanced_access_sessions WHERE id = ?
        """,
        (session_id,),
    )
    row = cursor.fetchone()
    conn.close()
    return AdvancedAccessSession.from_row(row) if row else None


def get_router_session(router_id: str, session_id: str) -> Optional[AdvancedAccessSession]:
    """Return session only when it belongs to the given router."""
    s = get_session(session_id)
    return s if (s and s.router_id == router_id) else None


def list_sessions(router_id: str) -> list:
    """Return the 50 most recent sessions for a router (any status)."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, router_id, user_id, service, service_port, allocated_port,
               router_wg_ip, expires_at, status, teardown_at, created_at
        FROM advanced_access_sessions
        WHERE router_id = ?
        ORDER BY created_at DESC LIMIT 50
        """,
        (router_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return [AdvancedAccessSession.from_row(r).as_dict() for r in rows]


def _fetch_expired_active() -> list:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute(
        """
        SELECT id, router_id, user_id, service, service_port, allocated_port,
               router_wg_ip, expires_at, status, teardown_at, created_at
        FROM advanced_access_sessions
        WHERE status = 'active' AND expires_at <= ?
        """,
        (now,),
    )
    rows = cursor.fetchall()
    conn.close()
    return [AdvancedAccessSession.from_row(r) for r in rows]


# ── Permission gate (defence-in-depth) ────────────────────────────────────────

def _assert_permission(user_id: str, router_id: str) -> None:
    """
    Raise ValueError if the user lacks advanced-access rights.
    Primary enforcement is in the API layer; this is a second check so that
    internal callers (tests, scripts) cannot bypass the gate accidentally.
    """
    perm = get_permission(user_id, router_id)
    if not (perm.can_remote_action and perm.can_reboot):
        raise ValueError(
            f"User '{user_id}' lacks advanced access rights on router '{router_id}' "
            "(requires can_remote_action AND can_reboot)"
        )


# ── Core operations ────────────────────────────────────────────────────────────

def create_session(
    router_id: str,
    user_id: str,
    service: str,
    duration_seconds: int,
) -> AdvancedAccessSession:
    """
    Validate → allocate port → install iptables rule → persist session.

    Fails closed: if iptables fails the session is NOT persisted and a
    RuntimeError is raised so the HTTP layer returns 503.

    Raises:
        ValueError  — bad input or router not ready
        RuntimeError — infrastructure failure (iptables, port pool)
    """
    _assert_permission(user_id, router_id)

    r = get_router(router_id)
    if not r:
        raise ValueError("Router not found")
    if r.state not in _ALLOWED_STATES:
        raise ValueError(
            f"Router must be TUNNEL_UP or DONE (current: {r.state.value})"
        )
    if not r.wg_ip:
        raise ValueError("Router has no WireGuard IP assigned")
    if service not in SERVICE_PORTS:
        raise ValueError(f"Unknown service '{service}'. Allowed: {sorted(SERVICE_PORTS)}")

    duration_seconds = max(1, min(duration_seconds, MAX_DURATION_SECONDS))
    service_port = SERVICE_PORTS[service]

    port = _allocate_port()
    if port is None:
        raise RuntimeError("Advanced access port pool exhausted")

    now = datetime.utcnow()
    session = AdvancedAccessSession(
        id=uuid.uuid4().hex,
        router_id=router_id,
        user_id=user_id,
        service=service,
        service_port=service_port,
        allocated_port=port,
        router_wg_ip=r.wg_ip,
        expires_at=now + timedelta(seconds=duration_seconds),
        status="active",
        teardown_at=None,
        created_at=now,
    )

    # Fail closed: do not persist if the forwarding rule cannot be installed.
    if not _iptables_add(port, r.wg_ip, service_port):
        log_audit(
            user_id, router_id,
            f"advanced_access:create:{service}",
            False,
            f"iptables failed for port={port}",
        )
        raise RuntimeError("Failed to install iptables forwarding rule")

    _save_session(session)
    log_audit(
        user_id, router_id,
        f"advanced_access:create:{service}",
        True,
        f"access_id={session.id} port={port} expires_at={session.expires_at.isoformat()}",
    )
    return session


def teardown_session(
    session: AdvancedAccessSession,
    status: str = "revoked",
    actor_user_id: Optional[str] = None,
) -> None:
    """
    Remove the iptables rule (best-effort) and mark the DB record.
    Safe to call multiple times — iptables -D on a missing rule is ignored,
    and the DB UPDATE is idempotent.
    """
    _iptables_remove(session.allocated_port, session.router_wg_ip, session.service_port)
    _mark_status(session.id, status)
    log_audit(
        actor_user_id or session.user_id,
        session.router_id,
        f"advanced_access:teardown:{status}",
        True,
        f"access_id={session.id} port={session.allocated_port}",
    )


# ── Background cleanup loop ────────────────────────────────────────────────────

async def cleanup_expired_sessions_loop() -> None:
    """
    Asyncio background task: sweep expired active sessions every
    _CLEANUP_INTERVAL_SECONDS.  Exceptions are swallowed so the loop
    never dies; CancelledError is re-raised so graceful shutdown works.
    """
    while True:
        try:
            await asyncio.sleep(_CLEANUP_INTERVAL_SECONDS)
            expired = _fetch_expired_active()
            for s in expired:
                try:
                    teardown_session(s, status="expired")
                    print(f"[advanced_access] expired session cleaned: {s.id} port={s.allocated_port}")
                except Exception as exc:
                    print(f"[advanced_access] cleanup error for {s.id}: {exc}")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"[advanced_access] cleanup loop error (continuing): {exc}")


def start_cleanup_loop() -> "asyncio.Task":
    """Schedule the cleanup loop and return the task so the caller can cancel it."""
    return asyncio.ensure_future(cleanup_expired_sessions_loop())
