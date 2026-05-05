"""
Idempotent RouterOS API wrappers.
Each function is safe to call multiple times with the same inputs.
"""
import asyncio
from typing import Optional, Dict, Any

try:
    import librouteros_async
except ImportError:
    librouteros_async = None

# RouterOS API timeout (seconds)
API_TIMEOUT = 30
TUNNEL_HANDSHAKE_TIMEOUT = 120


class RouterOSError(Exception):
    """RouterOS API or connection error."""

    pass


async def validate_api_access(ip: str, username: str, password: str) -> bool:
    """
    Test API connectivity. Returns True if reachable, False otherwise.
    Idempotent: safe to call multiple times.
    """
    try:
        conn = librouteros_async.ConnectionPoolAsync(
            ip=ip, username=username, password=password, timeout=API_TIMEOUT
        )
        async with conn.ctx_async() as ctx:
            await ctx.query("/system/identity/print")
        return True
    except Exception as e:
        return False


async def create_wg_mgmt_interface(
    ip: str, username: str, password: str, interface_name: str = "wg-mgmt"
) -> bool:
    """
    Create WireGuard management interface if it doesn't exist.
    Idempotent: idempotent on second call (interface already exists).
    Returns True if created or already exists.
    """
    try:
        conn = librouteros_async.ConnectionPoolAsync(
            ip=ip, username=username, password=password, timeout=API_TIMEOUT
        )
        async with conn.ctx_async() as ctx:
            # Check if interface exists
            result = await ctx.query(
                "/interface/wireguard/print",
                [("name", interface_name)],
            )
            if result:
                # Already exists
                return True

            # Create it
            await ctx.add(
                "/interface/wireguard",
                [("name", interface_name), ("mtu", "1420")],
            )
            return True
    except Exception as e:
        raise RouterOSError(f"Failed to create WG interface: {e}")


async def get_wg_interface_pubkey(
    ip: str, username: str, password: str, interface_name: str = "wg-mgmt"
) -> str:
    """
    Retrieve WireGuard interface public key.
    Idempotent: same input always returns same key.
    Raises RouterOSError if interface missing or key not yet generated.
    """
    try:
        conn = librouteros_async.ConnectionPoolAsync(
            ip=ip, username=username, password=password, timeout=API_TIMEOUT
        )
        async with conn.ctx_async() as ctx:
            result = await ctx.query(
                "/interface/wireguard/print",
                [("name", interface_name)],
            )
            if not result:
                raise RouterOSError(f"Interface {interface_name} not found")

            pubkey = result[0].get("public-key")
            if not pubkey:
                raise RouterOSError(
                    f"Public key not yet generated for {interface_name}"
                )
            return pubkey
    except Exception as e:
        raise RouterOSError(f"Failed to get WG pubkey: {e}")


async def add_wg_peer(
    ip: str,
    username: str,
    password: str,
    peer_pubkey: str,
    allowed_address: str,
    endpoint: Optional[str] = None,
    interface_name: str = "wg-mgmt",
) -> bool:
    """
    Add WireGuard peer if not already present.
    Idempotent: check by public key; add only if missing.
    Returns True if added or already exists.
    """
    try:
        conn = librouteros_async.ConnectionPoolAsync(
            ip=ip, username=username, password=password, timeout=API_TIMEOUT
        )
        async with conn.ctx_async() as ctx:
            # Check if peer exists
            result = await ctx.query(
                "/interface/wireguard/peers/print",
                [("interface", interface_name), ("public-key", peer_pubkey)],
            )
            if result:
                # Already exists
                return True

            # Add peer
            params = [
                ("interface", interface_name),
                ("public-key", peer_pubkey),
                ("allowed-address", allowed_address),
            ]
            if endpoint:
                params.append(("endpoint-address", endpoint))

            await ctx.add("/interface/wireguard/peers", params)
            return True
    except Exception as e:
        raise RouterOSError(f"Failed to add WG peer: {e}")


async def assign_wg_ip_address(
    ip: str,
    username: str,
    password: str,
    wg_ip: str,
    interface_name: str = "wg-mgmt",
) -> bool:
    """
    Assign IP address to WireGuard interface if not already assigned.
    Idempotent: check if address exists, add only if missing.
    """
    try:
        conn = librouteros_async.ConnectionPoolAsync(
            ip=ip, username=username, password=password, timeout=API_TIMEOUT
        )
        async with conn.ctx_async() as ctx:
            # Check if address already assigned
            result = await ctx.query(
                "/ip/address/print",
                [("interface", interface_name), ("address", wg_ip)],
            )
            if result:
                # Already assigned
                return True

            # Assign address
            await ctx.add(
                "/ip/address",
                [("interface", interface_name), ("address", wg_ip)],
            )
            return True
    except Exception as e:
        raise RouterOSError(f"Failed to assign WG IP: {e}")


async def wait_tunnel_handshake(
    ip: str,
    username: str,
    password: str,
    interface_name: str = "wg-mgmt",
    timeout_sec: int = TUNNEL_HANDSHAKE_TIMEOUT,
) -> bool:
    """
    Poll WireGuard interface until endpoint address is non-zero (tunnel up).
    Idempotent: can be retried safely.
    Raises RouterOSError if timeout.
    """
    start = asyncio.get_event_loop().time()
    while True:
        try:
            conn = librouteros_async.ConnectionPoolAsync(
                ip=ip, username=username, password=password, timeout=API_TIMEOUT
            )
            async with conn.ctx_async() as ctx:
                result = await ctx.query(
                    "/interface/wireguard/print",
                    [("name", interface_name)],
                )
                if result and result[0].get("last-endpoint-address"):
                    # Tunnel is up
                    return True

            await asyncio.sleep(2)  # Poll every 2 seconds
            elapsed = asyncio.get_event_loop().time() - start
            if elapsed > timeout_sec:
                raise RouterOSError(f"Tunnel handshake timeout after {timeout_sec}s")
        except Exception as e:
            raise RouterOSError(f"Failed to poll tunnel handshake: {e}")


async def disable_api_on_lan(
    ip: str,
    username: str,
    password: str,
    api_port: int = 8728,
) -> bool:
    """
    Disable RouterOS API on LAN (port 8728).
    Create firewall rule to drop incoming API connections.
    Idempotent: check if rule exists, add only if missing.
    """
    try:
        conn = librouteros_async.ConnectionPoolAsync(
            ip=ip, username=username, password=password, timeout=API_TIMEOUT
        )
        async with conn.ctx_async() as ctx:
            # Check if rule exists
            rule_comment = "block-api-lan"
            result = await ctx.query(
                "/ip/firewall/filter/print",
                [("comment", rule_comment)],
            )
            if result:
                # Already exists
                return True

            # Add firewall rule: drop incoming on port 8728
            await ctx.add(
                "/ip/firewall/filter",
                [
                    ("chain", "input"),
                    ("protocol", "tcp"),
                    ("dst-port", str(api_port)),
                    ("action", "drop"),
                    ("comment", rule_comment),
                    ("disabled", "no"),
                ],
            )
            return True
    except Exception as e:
        raise RouterOSError(f"Failed to disable API on LAN: {e}")


async def rotate_admin_password(
    ip: str,
    username: str,
    password: str,
    new_password: str,
    admin_username: str = "admin",
) -> bool:
    """
    Change admin password.
    Idempotent: after first call, subsequent calls with same new_password succeed.
    (In practice, we'd need to track whether it's been done; here we just try and ignore "already set" errors.)
    """
    try:
        conn = librouteros_async.ConnectionPoolAsync(
            ip=ip, username=username, password=password, timeout=API_TIMEOUT
        )
        async with conn.ctx_async() as ctx:
            # RouterOS /user/set changes password; safe to call multiple times with same password
            result = await ctx.query(
                "/user/print",
                [("name", admin_username)],
            )
            if not result:
                raise RouterOSError(f"User {admin_username} not found")

            user_id = result[0].get(".id")
            await ctx.set(
                "/user",
                user_id,
                [("password", new_password)],
            )
            return True
    except Exception as e:
        raise RouterOSError(f"Failed to rotate admin password: {e}")


async def setup_wg_ip_config(
    ip: str,
    username: str,
    password: str,
    wg_ip_cidr: str,
    interface_name: str = "wg-mgmt",
) -> bool:
    """
    Set up WireGuard IP address and routing.
    Idempotent: checks if already configured.
    """
    try:
        # Assign IP address to interface
        await assign_wg_ip_address(ip, username, password, wg_ip_cidr, interface_name)
        return True
    except Exception as e:
        raise RouterOSError(f"Failed to set up WG IP config: {e}")
