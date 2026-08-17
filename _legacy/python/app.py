"""
Minimal MikroTik Router Onboarding MVP
Single endpoint, single flow, reuses validated RouterOS API logic from t.py
"""

import asyncio
import logging
import secrets
import string
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from routeros_api import RouterOsApiPool

app = FastAPI()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# In-memory state (replace with DB for real usage)
onboarding_state: dict = {}

BACKEND_PUBLIC_KEY = "1XQ53CfYH/AyDdWpTZXK0dVMdda9dqPcA3Gh1F8D4Bo="  # Replace with real key
BACKEND_IP = "203.0.113.100"  # Replace with real backend IP


class OnboardRequest(BaseModel):
    router_ip: str
    admin_user: str
    admin_pass: str


class OnboardResponse(BaseModel):
    status: str
    router_id: str
    message: str
    tunnel_ip: Optional[str] = None


@app.post("/routers/onboard", response_model=OnboardResponse)
async def onboard_router(req: OnboardRequest):
    """Start onboarding flow: WireGuard setup + hardening."""
    router_id = req.router_ip  # Use IP as simple identifier
    onboarding_state[router_id] = {"step": "starting", "progress": []}

    try:
        # Connect to router
        onboarding_state[router_id]["step"] = "connecting"
        api_pool = RouterOsApiPool(
            host=req.router_ip,
            username=req.admin_user,
            password=req.admin_pass,
            port=8728,  # LAN API (plaintext for testing)
            plaintext_login=True,
        )
        api = api_pool.get_api()
        onboarding_state[router_id]["progress"].append("✅ Connected to RouterOS API")

        # Get system identity
        identity = api.get_resource("/system/identity").get()
        logger.info(f"Router identity: {identity}")

        # Create/ensure WireGuard interface
        onboarding_state[router_id]["step"] = "wg_interface"
        wg = api.get_resource("/interface/wireguard")
        interfaces = wg.get()

        wg_iface = next((i for i in interfaces if i["name"] == "wg-mgmt"), None)
        if not wg_iface:
            wg.add(name="wg-mgmt", listen_port="51820", mtu="1420")
            onboarding_state[router_id]["progress"].append("✅ Created WireGuard interface wg-mgmt")
        else:
            onboarding_state[router_id]["progress"].append("ℹ️ WireGuard interface already exists")

        # Get router's WireGuard public key
        interfaces = wg.get()
        router_pubkey = next(i["public-key"] for i in interfaces if i["name"] == "wg-mgmt")
        onboarding_state[router_id]["progress"].append(f"✅ Router public key: {router_pubkey[:20]}...")

        # Add backend as WireGuard peer
        onboarding_state[router_id]["step"] = "add_peer"
        peers = api.get_resource("/interface/wireguard/peers")
        existing_peers = peers.get()
        peer_exists = any(
            p.get("interface") == "wg-mgmt" and p.get("endpoint-address") == BACKEND_IP
            for p in existing_peers
        )

        if not peer_exists:
            peers.add(
                interface="wg-mgmt",
                public_key=BACKEND_PUBLIC_KEY.strip(),
                endpoint_address=BACKEND_IP,
                endpoint_port="51820",
                allowed_address="10.255.0.1/32",
                persistent_keepalive="25",
            )
            onboarding_state[router_id]["progress"].append("✅ Added backend as WireGuard peer")
        else:
            onboarding_state[router_id]["progress"].append("ℹ️ Backend peer already exists")

        # Assign WireGuard IP to interface
        onboarding_state[router_id]["step"] = "assign_ip"
        ip_addr = api.get_resource("/ip/address")
        addresses = ip_addr.get()
        has_ip = any(a["interface"] == "wg-mgmt" for a in addresses)

        if not has_ip:
            ip_addr.add(address="10.255.0.2/32", interface="wg-mgmt")
            onboarding_state[router_id]["progress"].append("✅ Assigned WireGuard IP: 10.255.0.2/32")
        else:
            onboarding_state[router_id]["progress"].append("ℹ️ WireGuard IP already assigned")

        # Wait for WireGuard handshake
        onboarding_state[router_id]["step"] = "handshake"
        for attempt in range(10):  # Wait up to 10 seconds
            try:
                # Check if peer is active by querying /interface/wireguard/peers
                peers = api.get_resource("/interface/wireguard/peers").get()
                peer = next(
                    (p for p in peers if p.get("endpoint-address") == BACKEND_IP),
                    None,
                )
                if peer and peer.get("last-handshake"):
                    onboarding_state[router_id]["progress"].append("✅ WireGuard handshake established")
                    break
            except Exception:
                pass

            if attempt < 9:
                await asyncio.sleep(1)

        # Rotate admin password
        onboarding_state[router_id]["step"] = "rotate_password"
        new_admin_pass = _generate_password()
        api.get_resource("/user").update(
            id="*1",  # admin user ID is usually *1
            password=new_admin_pass,
        )
        onboarding_state[router_id]["progress"].append("✅ Admin password rotated")

        # Disable LAN API (port 8728, insecure)
        onboarding_state[router_id]["step"] = "disable_lan_api"
        ip_services = api.get_resource("/ip/service")
        services = ip_services.get()
        api_service = next((s for s in services if s.get("name") == "api"), None)
        if api_service:
            ip_services.update(id=api_service[".id"], disabled="true")
            onboarding_state[router_id]["progress"].append("✅ Disabled LAN API (port 8728)")

        # Success
        onboarding_state[router_id]["step"] = "completed"
        onboarding_state[router_id]["tunnel_ip"] = "10.255.0.2"

        return OnboardResponse(
            status="success",
            router_id=router_id,
            message="Router onboarded successfully",
            tunnel_ip="10.255.0.2",
        )

    except Exception as e:
        logger.error(f"Onboarding failed: {e}", exc_info=True)
        onboarding_state[router_id]["error"] = str(e)
        onboarding_state[router_id]["step"] = "error"
        raise HTTPException(status_code=500, detail=f"Onboarding failed: {str(e)}")


@app.get("/status/{router_ip}")
async def get_status(router_ip: str):
    """Get current onboarding status for a router."""
    if router_ip not in onboarding_state:
        raise HTTPException(status_code=404, detail="Router not found")

    state = onboarding_state[router_ip]
    return {
        "router_ip": router_ip,
        "step": state.get("step"),
        "progress": state.get("progress", []),
        "tunnel_ip": state.get("tunnel_ip"),
        "error": state.get("error"),
    }


@app.get("/health")
async def health():
    """Health check."""
    return {"status": "ok"}


def _generate_password(length: int = 32) -> str:
    """Generate a secure random password."""
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(chars) for _ in range(length))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
