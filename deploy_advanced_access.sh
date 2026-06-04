#!/bin/bash
# Run this script ON THE VPS after uploading the new files.
# Usage:  bash /tmp/deploy_advanced_access.sh
set -e

echo "=== Advanced Access Deployment ==="

# ── 1. Locate the backend directory ──────────────────────────────────────────
# Try known locations; fall back to whatever directory contains main.py
BACKEND_DIR=""
for candidate in /opt/mikrolan/backend /opt/mikrolan /root/mikrolan /srv/mikrolan; do
    if [ -f "$candidate/main.py" ]; then
        BACKEND_DIR="$candidate"
        break
    fi
done

if [ -z "$BACKEND_DIR" ]; then
    echo "ERROR: Cannot locate main.py. Set BACKEND_DIR manually:"
    echo "  BACKEND_DIR=/your/path bash /tmp/deploy_advanced_access.sh"
    exit 1
fi
echo "✓ Backend directory: $BACKEND_DIR"

# ── 2. Copy new files ─────────────────────────────────────────────────────────
cp /tmp/advanced_access.py        "$BACKEND_DIR/advanced_access.py"
cp /tmp/advanced_access_router.py "$BACKEND_DIR/advanced_access_router.py"
cp /tmp/main.py                   "$BACKEND_DIR/main.py"
echo "✓ Files copied"

# ── 3. One-time iptables WireGuard forwarding (idempotent) ────────────────────
# These are broad rules required for DNAT through the WG tunnel.
# check-then-insert pattern so re-running this script is safe.
sysctl -w net.ipv4.ip_forward=1 > /dev/null

add_if_missing() {
    if ! iptables "$@" 2>/dev/null; then
        iptables "${@/-C/-A}"
    fi
}
# Detect WireGuard interface name (wg0 or wg-mgmt-backend)
WG_IFACE=$(ip link show | grep -oP '(wg\S+)' | head -1)
if [ -z "$WG_IFACE" ]; then
    echo "WARNING: No WireGuard interface found. Skipping FORWARD rules."
    echo "  Run manually after wg interface is up:"
    echo "  iptables -A FORWARD -i <wg-iface> -j ACCEPT"
    echo "  iptables -A FORWARD -o <wg-iface> -j ACCEPT"
    echo "  iptables -t nat -A POSTROUTING -s 10.0.0.0/24 -j MASQUERADE"
else
    iptables -C FORWARD -i "$WG_IFACE" -j ACCEPT 2>/dev/null || iptables -A FORWARD -i "$WG_IFACE" -j ACCEPT
    iptables -C FORWARD -o "$WG_IFACE" -j ACCEPT 2>/dev/null || iptables -A FORWARD -o "$WG_IFACE" -j ACCEPT
    iptables -t nat -C POSTROUTING -s 10.0.0.0/24 -j MASQUERADE 2>/dev/null || \
        iptables -t nat -A POSTROUTING -s 10.0.0.0/24 -j MASQUERADE
    echo "✓ iptables WireGuard forwarding rules in place (iface: $WG_IFACE)"
fi

# Persist iptables rules across reboots if netfilter-persistent is available
if command -v netfilter-persistent &>/dev/null; then
    netfilter-persistent save > /dev/null 2>&1 && echo "✓ iptables rules saved"
elif command -v iptables-save &>/dev/null; then
    iptables-save > /etc/iptables/rules.v4 2>/dev/null && echo "✓ iptables rules saved to /etc/iptables/rules.v4" || true
fi

# ── 4. Open the advanced-access port range in UFW / firewall if present ───────
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 40000:49999/tcp comment "mikrolan-advanced-access" > /dev/null 2>&1
    echo "✓ UFW: 40000-49999/tcp allowed"
fi

# ── 5. Restart the backend service ───────────────────────────────────────────
SERVICE=""
for svc in mikrolan-backend mikrolan backend; do
    if systemctl list-units --full --all | grep -q "${svc}.service"; then
        SERVICE="$svc"
        break
    fi
done

if [ -n "$SERVICE" ]; then
    systemctl restart "$SERVICE"
    sleep 2
    if systemctl is-active --quiet "$SERVICE"; then
        echo "✓ Service '$SERVICE' restarted successfully"
    else
        echo "✗ Service '$SERVICE' failed to restart"
        systemctl status "$SERVICE" --no-pager -l
        exit 1
    fi
else
    echo "WARNING: No systemd backend service found."
    echo "  Restart manually: cd $BACKEND_DIR && uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1"
fi

# ── 6. Smoke test ─────────────────────────────────────────────────────────────
sleep 1
if curl -sf http://localhost:8000/health > /dev/null; then
    echo "✓ Health check passed"
else
    echo "WARNING: Health check failed — backend may not be listening yet"
fi

echo ""
echo "=== Done ==="
echo "New endpoints available:"
echo "  POST   /routers/{id}/advanced-access"
echo "  GET    /routers/{id}/advanced-access"
echo "  GET    /routers/{id}/advanced-access/{access_id}"
echo "  DELETE /routers/{id}/advanced-access/{access_id}"
echo ""
echo "Requires X-User-ID header with can_remote_action AND can_reboot permissions."
echo "Ephemeral ports: 40000-49999  |  Max duration: ${ADVANCED_ACCESS_MAX_DURATION:-3600}s"
