"""
Idempotent RouterOS API wrappers using librouteros async API.
Each function is safe to call multiple times with the same inputs.
"""
import asyncio
import platform
import subprocess
from typing import Optional

import librouteros

API_TIMEOUT = 30
TUNNEL_HANDSHAKE_TIMEOUT = 120
WG_BACKEND_INTERFACE = "wg-mgmt-backend"
WG_BACKEND_PORT = 51820


class RouterOSError(Exception):
    """RouterOS API or connection error."""
    pass


async def _connect(ip: str, username: str, password: str):
    """Establish RouterOS API connection."""
    return await librouteros.async_connect(
        host=ip, username=username, password=password, timeout=API_TIMEOUT
    )


async def _collect(gen) -> list:
    """Collect all items from an async generator into a list."""
    return [item async for item in gen]


async def validate_api_access(ip: str, username: str, password: str) -> bool:
    """
    Test API connectivity. Returns True if reachable, False otherwise.
    Idempotent: safe to call multiple times.
    """
    api = None
    try:
        api = await _connect(ip, username, password)
        await _collect(api("/system/identity/print"))
        return True
    except Exception:
        return False
    finally:
        if api:
            try:
                await api.close()
            except Exception:
                pass


async def create_wg_mgmt_interface(
    ip: str, username: str, password: str, interface_name: str = "wg-mgmt"
) -> bool:
    """
    Create WireGuard management interface if it doesn't exist.
    Idempotent: no-op if already exists.
    """
    api = await _connect(ip, username, password)
    try:
        ifaces = await _collect(api("/interface/wireguard/print"))
        if any(i.get("name") == interface_name for i in ifaces):
            return True
        await api.path("interface", "wireguard").add(name=interface_name, mtu="1420")
        return True
    except Exception as e:
        raise RouterOSError(f"Failed to create WG interface: {e}")
    finally:
        await api.close()


async def get_wg_interface_info(
    ip: str, username: str, password: str, interface_name: str = "wg-mgmt"
) -> dict:
    """
    Retrieve WireGuard interface info: public key and listen port.
    Returns dict with 'pubkey' and 'listen_port'.
    """
    api = await _connect(ip, username, password)
    try:
        ifaces = await _collect(api("/interface/wireguard/print"))
        iface = next((i for i in ifaces if i.get("name") == interface_name), None)
        if not iface:
            raise RouterOSError(f"Interface {interface_name} not found")
        pubkey = iface.get("public-key")
        if not pubkey:
            raise RouterOSError(f"Public key not yet generated for {interface_name}")
        listen_port = int(iface.get("listen-port", 51820))
        return {"pubkey": pubkey, "listen_port": listen_port}
    except RouterOSError:
        raise
    except Exception as e:
        raise RouterOSError(f"Failed to get WG interface info: {e}")
    finally:
        await api.close()


async def get_wg_interface_pubkey(
    ip: str, username: str, password: str, interface_name: str = "wg-mgmt"
) -> str:
    """
    Retrieve WireGuard interface public key.
    Raises RouterOSError if interface missing or key not yet generated.
    """
    info = await get_wg_interface_info(ip, username, password, interface_name)
    return info["pubkey"]


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
    endpoint format: "host:port" or None.
    """
    api = await _connect(ip, username, password)
    try:
        peers = await _collect(api("/interface/wireguard/peers/print"))
        if any(p.get("public-key") == peer_pubkey for p in peers):
            return True
        kwargs = {
            "interface": interface_name,
            "public-key": peer_pubkey,
            "allowed-address": allowed_address,
        }
        if endpoint:
            ep_host, ep_port = endpoint.rsplit(":", 1)
            kwargs["endpoint-address"] = ep_host
            kwargs["endpoint-port"] = ep_port
        await api.path("interface", "wireguard", "peers").add(**kwargs)
        return True
    except Exception as e:
        raise RouterOSError(f"Failed to add WG peer: {e}")
    finally:
        await api.close()


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
    api = await _connect(ip, username, password)
    try:
        addrs = await _collect(api("/ip/address/print"))
        if any(
            a.get("interface") == interface_name and a.get("address") == wg_ip
            for a in addrs
        ):
            return True
        await api.path("ip", "address").add(interface=interface_name, address=wg_ip)
        return True
    except Exception as e:
        raise RouterOSError(f"Failed to assign WG IP: {e}")
    finally:
        await api.close()


def _add_backend_wg_peer(
    router_pubkey: str,
    router_wg_ip: str,
) -> None:
    """
    Register the router as a WireGuard peer on the VPS interface.
    Router initiates the connection (dials VPS endpoint); VPS never dials LAN.
    No endpoint is set here — WireGuard learns it from the router's first packet.
    Idempotent: wg set updates existing peer if already present.
    """
    peer_ip = router_wg_ip.split("/")[0]
    wg_args = [
        "wg", "set", WG_BACKEND_INTERFACE,
        "peer", router_pubkey,
        "allowed-ips", f"{peer_ip}/32",
        "persistent-keepalive", "25",
    ]
    if platform.system() == "Windows":
        cmd = ["wsl", "-d", "Ubuntu", "-u", "root", "-e"] + wg_args
    else:
        cmd = wg_args
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    if result.returncode != 0:
        raise RouterOSError(
            f"Failed to configure backend WG peer: {result.stderr.strip() or result.stdout.strip()}"
        )


async def wait_tunnel_handshake_vps_side(
    router_pubkey: str,
    interface: str = WG_BACKEND_INTERFACE,
    timeout_sec: int = TUNNEL_HANDSHAKE_TIMEOUT,
) -> bool:
    """
    Poll the VPS WireGuard interface for a confirmed handshake from the router.
    The router initiates; VPS checks its own `wg show` output.
    Raises RouterOSError on timeout.
    """
    import time

    start = asyncio.get_event_loop().time()
    while True:
        try:
            if platform.system() == "Windows":
                cmd = ["wsl", "-d", "Ubuntu", "-u", "root", "-e",
                       "wg", "show", interface, "latest-handshakes"]
            else:
                cmd = ["wg", "show", interface, "latest-handshakes"]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            for line in result.stdout.splitlines():
                parts = line.strip().split()
                if len(parts) >= 2 and parts[0] == router_pubkey:
                    handshake_ts = int(parts[1])
                    if handshake_ts > 0 and (time.time() - handshake_ts) < 180:
                        return True
        except Exception:
            pass
        elapsed = asyncio.get_event_loop().time() - start
        if elapsed > timeout_sec:
            raise RouterOSError(f"VPS-side tunnel handshake timeout after {timeout_sec}s")
        await asyncio.sleep(5)


async def wait_tunnel_handshake(
    ip: str,
    username: str,
    password: str,
    interface_name: str = "wg-mgmt",
    timeout_sec: int = TUNNEL_HANDSHAKE_TIMEOUT,
) -> bool:
    """
    Poll until the WireGuard tunnel handshake is confirmed.
    Checks the router's peer for current-endpoint-address (set when backend connects).
    Idempotent: can be retried safely.
    Raises RouterOSError if timeout.
    """
    start = asyncio.get_event_loop().time()
    while True:
        api = None
        try:
            api = await _connect(ip, username, password)
            peers = await _collect(api("/interface/wireguard/peers/print"))
            peer = next((p for p in peers if p.get("interface") == interface_name), None)
            await api.close()
            api = None
            if peer and peer.get("current-endpoint-address"):
                return True
        except Exception:
            if api:
                try:
                    await api.close()
                except Exception:
                    pass

        elapsed = asyncio.get_event_loop().time() - start
        if elapsed > timeout_sec:
            raise RouterOSError(f"Tunnel handshake timeout after {timeout_sec}s")
        await asyncio.sleep(2)


async def disable_api_on_lan(
    ip: str,
    username: str,
    password: str,
    api_port: int = 8728,
) -> bool:
    """
    Block API port from LAN while keeping it reachable via WireGuard tunnel.
    Idempotent: each rule is only added if not already present.
    """
    api = await _connect(ip, username, password)
    try:
        rules = await _collect(api("/ip/firewall/filter/print"))

        accept_comment = "allow-api-wg"
        if not any(r.get("comment") == accept_comment for r in rules):
            await api.path("ip", "firewall", "filter").add(**{
                "chain": "input",
                "protocol": "tcp",
                "dst-port": str(api_port),
                "in-interface": "wg-mgmt",
                "action": "accept",
                "comment": accept_comment,
                "disabled": "no",
            })

        drop_comment = "block-api-lan"
        if not any(r.get("comment") == drop_comment for r in rules):
            await api.path("ip", "firewall", "filter").add(**{
                "chain": "input",
                "protocol": "tcp",
                "dst-port": str(api_port),
                "action": "drop",
                "comment": drop_comment,
                "disabled": "no",
            })
        return True
    except Exception as e:
        raise RouterOSError(f"Failed to disable API on LAN: {e}")
    finally:
        await api.close()


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
    """
    api = await _connect(ip, username, password)
    try:
        users = await _collect(api("/user/print"))
        user = next((u for u in users if u.get("name") == admin_username), None)
        if not user:
            raise RouterOSError(f"User {admin_username} not found")
        user_id = user.get(".id")
        await api.path("user").update(**{".id": user_id, "password": new_password})
        return True
    except RouterOSError:
        raise
    except Exception as e:
        raise RouterOSError(f"Failed to rotate admin password: {e}")
    finally:
        await api.close()


async def remove_firewall_rule_by_comment(
    ip: str,
    username: str,
    password: str,
    comment: str = "block-api-lan",
) -> bool:
    """
    Remove the firewall rule identified by its comment field.
    Idempotent: no-op if the rule is already gone.
    """
    api = await _connect(ip, username, password)
    try:
        rules = await _collect(api("/ip/firewall/filter/print"))
        rule = next((r for r in rules if r.get("comment") == comment), None)
        if not rule:
            return True
        rule_id = rule.get(".id")
        await api.path("ip", "firewall", "filter").remove(rule_id)
        return True
    except Exception as e:
        raise RouterOSError(f"Failed to remove firewall rule '{comment}': {e}")
    finally:
        await api.close()


async def remove_wg_peer_by_pubkey(
    ip: str,
    username: str,
    password: str,
    peer_pubkey: str,
    interface_name: str = "wg-mgmt",
) -> bool:
    """
    Remove WireGuard peer matched by public key.
    Idempotent: no-op if peer is already gone.
    """
    api = await _connect(ip, username, password)
    try:
        peers = await _collect(api("/interface/wireguard/peers/print"))
        peer = next((p for p in peers if p.get("public-key") == peer_pubkey), None)
        if not peer:
            return True
        peer_id = peer.get(".id")
        await api.path("interface", "wireguard", "peers").remove(peer_id)
        return True
    except Exception as e:
        raise RouterOSError(f"Failed to remove WG peer: {e}")
    finally:
        await api.close()


async def remove_wg_ip_address(
    ip: str,
    username: str,
    password: str,
    wg_ip: str,
    interface_name: str = "wg-mgmt",
) -> bool:
    """
    Remove IP address from WireGuard interface.
    Idempotent: no-op if address is already gone.
    """
    api = await _connect(ip, username, password)
    try:
        addrs = await _collect(api("/ip/address/print"))
        host = wg_ip.split("/")[0]
        addr = next(
            (a for a in addrs
             if a.get("interface") == interface_name
             and a.get("address", "").split("/")[0] == host),
            None,
        )
        if not addr:
            return True
        addr_id = addr.get(".id")
        await api.path("ip", "address").remove(addr_id)
        return True
    except Exception as e:
        raise RouterOSError(f"Failed to remove WG IP address: {e}")
    finally:
        await api.close()


async def remove_wg_interface(
    ip: str,
    username: str,
    password: str,
    interface_name: str = "wg-mgmt",
) -> bool:
    """
    Remove WireGuard interface by name.
    Idempotent: no-op if interface is already gone.
    """
    api = await _connect(ip, username, password)
    try:
        ifaces = await _collect(api("/interface/wireguard/print"))
        iface = next((i for i in ifaces if i.get("name") == interface_name), None)
        if not iface:
            return True
        iface_id = iface.get(".id")
        await api.path("interface", "wireguard").remove(iface_id)
        return True
    except Exception as e:
        raise RouterOSError(f"Failed to remove WG interface '{interface_name}': {e}")
    finally:
        await api.close()


async def reset_admin_password(
    ip: str,
    username: str,
    password: str,
    original_password: str,
    admin_username: str = "admin",
) -> bool:
    """
    Reset admin password back to its original value.
    Idempotent: calling again with the already-restored password still succeeds.
    """
    api = await _connect(ip, username, password)
    try:
        users = await _collect(api("/user/print"))
        user = next((u for u in users if u.get("name") == admin_username), None)
        if not user:
            raise RouterOSError(f"User {admin_username} not found")
        user_id = user.get(".id")
        await api.path("user").update(**{".id": user_id, "password": original_password})
        return True
    except RouterOSError:
        raise
    except Exception as e:
        raise RouterOSError(f"Failed to reset admin password: {e}")
    finally:
        await api.close()


async def setup_wg_ip_config(
    ip: str,
    username: str,
    password: str,
    wg_ip_cidr: str,
    interface_name: str = "wg-mgmt",
) -> bool:
    """
    Set up WireGuard IP address.
    Idempotent: checks if already configured.
    """
    await assign_wg_ip_address(ip, username, password, wg_ip_cidr, interface_name)
    return True
