#!/bin/bash
# Backend startup script for WSL2 — sets up WG interface then starts FastAPI

set -e

# 1. Set up WireGuard backend interface (idempotent)
if ! ip link show wg-mgmt-backend > /dev/null 2>&1; then
    ip link add wg-mgmt-backend type wireguard
    wg set wg-mgmt-backend listen-port 51820 private-key /etc/wireguard/wg-backend.key
    ip addr add 10.0.0.1/24 dev wg-mgmt-backend
    ip link set wg-mgmt-backend up
    echo "[WG] wg-mgmt-backend interface created"
else
    echo "[WG] wg-mgmt-backend already exists"
fi

# 2. Export environment
export ENCRYPTION_KEY="2a51962f7242781ae93a413d4ebb670a9cee7d95274eedf954d054951df9df14"
export BACKEND_WG_PUBKEY="GrKRKRZVlrd6ttGw/CZ/eu0cFtTggjwYnQkL+8BoYQI="
export PORT="8000"
export DB_PATH="/tmp/routers.db"

# 3. Start backend
cd /mnt/c/Users/PC/OneDrive\ -\ Epitech/amy/PROJETS-TERMINES/mikrolan
exec python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --log-level info
