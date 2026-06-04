"""
Example client for MikroTik provisioning backend.
Demonstrates API usage and concurrent onboarding.
"""
import asyncio
import aiohttp
import json
import time
from typing import List, Dict

BASE_URL = "http://localhost:8000"


async def onboard_router(session: aiohttp.ClientSession, ip: str, username: str, password: str, wg_ip: str = None):
    """Onboard a single router."""
    if wg_ip is None:
        last_octet = ip.split(".")[-1]
        wg_ip = f"10.0.0.{last_octet}"

    payload = {
        "ip": ip,
        "username": username,
        "password": password,
        "wg_peer_ip": wg_ip,
    }

    async with session.post(f"{BASE_URL}/routers/onboard", json=payload) as resp:
        return await resp.json()


async def get_status(session: aiohttp.ClientSession, router_id: str) -> Dict:
    """Get current status of a router."""
    async with session.get(f"{BASE_URL}/routers/{router_id}/status") as resp:
        return await resp.json()


async def retry_router(session: aiohttp.ClientSession, router_id: str) -> Dict:
    """Retry a failed router."""
    async with session.post(f"{BASE_URL}/routers/{router_id}/retry") as resp:
        return await resp.json()


async def health_check(session: aiohttp.ClientSession) -> bool:
    """Check if backend is alive."""
    try:
        async with session.get(f"{BASE_URL}/health") as resp:
            return resp.status == 200
    except:
        return False


def format_status(status: Dict) -> str:
    """Pretty-print router status."""
    state = status.get("state", "UNKNOWN")
    error = status.get("error", "")
    pubkey = status.get("wg_pubkey", "")[:20] + "..." if status.get("wg_pubkey") else "N/A"

    lines = [
        f"  IP: {status.get('ip')}",
        f"  State: {state}",
        f"  WG Pubkey: {pubkey}",
        f"  WG IP: {status.get('wg_ip', 'N/A')}",
    ]

    if error:
        lines.append(f"  Error: {error}")

    progress = status.get("progress", [])
    if progress:
        lines.append(f"  Progress ({len(progress)} steps):")
        for step in progress[-3:]:  # Last 3 steps
            lines.append(f"    - {step['step']}: {step['status']}")

    return "\n".join(lines)


async def example_single_onboard():
    """Example 1: Onboard a single router and poll status."""
    print("\n=== Example 1: Single Router Onboarding ===\n")

    async with aiohttp.ClientSession() as session:
        # Check backend is running
        if not await health_check(session):
            print("❌ Backend not running. Start with: python main.py")
            return

        # Onboard
        print("Onboarding router 192.168.1.1...")
        result = await onboard_router(session, "192.168.1.1", "admin", "default")
        router_id = result["router_id"]
        print(f"✓ Router ID: {router_id}\n")

        # Poll status every 5 seconds
        for _ in range(30):
            status = await get_status(session, router_id)
            state = status["state"]
            print(f"State: {state:12} | Progress: {len(status['progress']):2} steps")

            if state == "DONE":
                print("\n✓ Onboarding complete!")
                print(format_status(status))
                break
            elif state == "ERROR":
                print(f"\n✗ Onboarding failed!")
                print(format_status(status))
                break

            await asyncio.sleep(5)


async def example_parallel_onboard():
    """Example 2: Onboard 5 routers in parallel."""
    print("\n=== Example 2: Parallel Onboarding (5 routers) ===\n")

    routers = [
        ("192.168.1.1", "admin", "default"),
        ("192.168.1.2", "admin", "default"),
        ("192.168.1.3", "admin", "default"),
        ("192.168.1.4", "admin", "default"),
        ("192.168.1.5", "admin", "default"),
    ]

    async with aiohttp.ClientSession() as session:
        # Check backend
        if not await health_check(session):
            print("❌ Backend not running.")
            return

        # Onboard all routers (non-blocking)
        print(f"Onboarding {len(routers)} routers in parallel...\n")
        router_ids = []
        for ip, user, pwd in routers:
            result = await onboard_router(session, ip, user, pwd)
            router_ids.append(result["router_id"])
            print(f"✓ Started {ip} (ID: {result['router_id'][:20]}...)")

        print(f"\nPolling status every 3 seconds...\n")

        # Poll all routers
        done_count = 0
        failed_count = 0
        for poll_cycle in range(60):
            states = {}
            for router_id in router_ids:
                status = await get_status(session, router_id)
                states[status["ip"]] = status["state"]

            # Print summary
            done_now = sum(1 for s in states.values() if s == "DONE")
            failed_now = sum(1 for s in states.values() if s == "ERROR")
            progress_now = sum(1 for s in states.values() if s not in ("NEW", "DONE", "ERROR"))

            state_summary = " | ".join(f"{ip.split('.')[-1]}: {state}" for ip, state in sorted(states.items()))
            print(f"Cycle {poll_cycle}: {state_summary}")

            if done_now + failed_now == len(routers):
                print(f"\n✓ All routers finished! Done: {done_now}, Failed: {failed_now}\n")

                # Show final status
                for router_id in router_ids:
                    status = await get_status(session, router_id)
                    print(f"\n{status['ip']}:")
                    print(format_status(status))
                break

            await asyncio.sleep(3)


async def example_failure_and_retry():
    """Example 3: Handle a failure and retry."""
    print("\n=== Example 3: Failure Handling & Retry ===\n")

    async with aiohttp.ClientSession() as session:
        if not await health_check(session):
            print("❌ Backend not running.")
            return

        # Onboard with a bad IP (will fail on API access)
        print("Onboarding unreachable router (192.168.99.99)...\n")
        result = await onboard_router(session, "192.168.99.99", "admin", "default")
        router_id = result["router_id"]

        # Wait for failure
        for _ in range(10):
            status = await get_status(session, router_id)
            if status["state"] == "ERROR":
                print(f"✗ Failed as expected:")
                print(format_status(status))
                break
            await asyncio.sleep(2)

        # Retry (would still fail, but demonstrates idempotency)
        print(f"\nRetrying router...\n")
        result = await retry_router(session, router_id)
        print(f"✓ {result['message']}")

        # Wait again
        for _ in range(5):
            status = await get_status(session, router_id)
            print(f"State: {status['state']}")
            if status["state"] != "ERROR" or _ == 4:
                break
            await asyncio.sleep(2)


async def example_monitor_progress():
    """Example 4: Monitor a single router in detail."""
    print("\n=== Example 4: Detailed Progress Monitoring ===\n")

    async with aiohttp.ClientSession() as session:
        if not await health_check(session):
            print("❌ Backend not running.")
            return

        # Onboard
        print("Onboarding 192.168.1.10 with detailed progress tracking...\n")
        result = await onboard_router(session, "192.168.1.10", "admin", "default")
        router_id = result["router_id"]

        # Poll and show each step
        last_step_count = 0
        for _ in range(60):
            status = await get_status(session, router_id)
            progress = status.get("progress", [])

            # Show new steps
            if len(progress) > last_step_count:
                for step in progress[last_step_count:]:
                    status_sym = "✓" if step["status"] == "success" else "✗" if step["status"] == "error" else "→"
                    msg = f" ({step['message']})" if step.get("message") else ""
                    print(f"{status_sym} {step['step']}: {step['status']}{msg}")
                last_step_count = len(progress)

            if status["state"] in ("DONE", "ERROR"):
                print(f"\nFinal state: {status['state']}")
                break

            await asyncio.sleep(2)


async def main():
    """Run all examples."""
    print("MikroTik Provisioning Backend - Example Client")
    print("=" * 50)

    # Choose example
    print("\nAvailable examples:")
    print("1. Single router onboarding (poll status)")
    print("2. Parallel onboarding (5 routers)")
    print("3. Failure handling & retry")
    print("4. Detailed progress monitoring")

    choice = input("\nChoose example (1-4, or 'all'): ").strip()

    if choice == "1":
        await example_single_onboard()
    elif choice == "2":
        await example_parallel_onboard()
    elif choice == "3":
        await example_failure_and_retry()
    elif choice == "4":
        await example_monitor_progress()
    elif choice.lower() == "all":
        await example_single_onboard()
        await asyncio.sleep(2)
        await example_parallel_onboard()
        await asyncio.sleep(2)
        await example_failure_and_retry()
        await asyncio.sleep(2)
        await example_monitor_progress()
    else:
        print("Invalid choice")


if __name__ == "__main__":
    asyncio.run(main())
