# Deployment & Usage Guide

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Set Environment Variables

```bash
export BACKEND_WG_PUBKEY="your_backend_wireguard_pubkey_here"
export DB_PATH="routers.db"
export ENCRYPTION_KEY="32-byte-encryption-key-here"
export PORT=8000
```

### 3. Run Server

```bash
python main.py
```

Or with uvicorn directly:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

**Note:** Use `--workers 1` (single process). Multiple worker processes would each have their own event loop and database, defeating concurrency benefits. All routing goes to a single process; it handles concurrency via asyncio.

### 4. Health Check

```bash
curl http://localhost:8000/health
```

Response:
```json
{"status": "ok"}
```

---

## Onboarding a Router

### Request

```bash
curl -X POST http://localhost:8000/routers/onboard \
  -H "Content-Type: application/json" \
  -d '{
    "ip": "192.168.1.1",
    "username": "admin",
    "password": "default",
    "wg_peer_ip": "10.0.0.2"
  }'
```

### Response

```json
{
  "router_id": "192.168.1.1_abc12345",
  "state": "NEW",
  "status_url": "/routers/192.168.1.1_abc12345/status"
}
```

**Returns immediately.** Onboarding happens asynchronously.

---

## Check Status

```bash
curl http://localhost:8000/routers/192.168.1.1_abc12345/status
```

### Response

```json
{
  "id": "192.168.1.1_abc12345",
  "ip": "192.168.1.1",
  "state": "WG_READY",
  "wg_pubkey": "qTVKSBV34vk...",
  "wg_ip": "10.0.0.2",
  "error": null,
  "progress": [
    {
      "step": "validate_api_access",
      "status": "success",
      "message": null,
      "at": "2026-05-05T10:00:00"
    },
    {
      "step": "create_wg_mgmt_interface",
      "status": "success",
      "message": null,
      "at": "2026-05-05T10:00:02"
    },
    {
      "step": "get_wg_pubkey",
      "status": "success",
      "message": null,
      "at": "2026-05-05T10:00:03"
    }
  ],
  "created_at": "2026-05-05T10:00:00",
  "updated_at": "2026-05-05T10:00:04"
}
```

**Poll this endpoint to track progress.** Typical onboarding takes 30–120 seconds (most time is waiting for tunnel handshake).

---

## Retry Failed Onboarding

If `state` is `ERROR`:

```bash
curl -X POST http://localhost:8000/routers/192.168.1.1_abc12345/retry
```

Response:
```json
{
  "message": "Retry initiated",
  "router_id": "192.168.1.1_abc12345"
}
```

**Safe to call multiple times.** The onboarding is idempotent; retrying will skip already-completed steps and resume from where it failed.

---

## Onboard Multiple Routers in Parallel

```bash
#!/bin/bash

ROUTERS=(
  "192.168.1.1"
  "192.168.1.2"
  "192.168.1.3"
  "192.168.1.4"
  "192.168.1.5"
)

for ip in "${ROUTERS[@]}"; do
  curl -X POST http://localhost:8000/routers/onboard \
    -H "Content-Type: application/json" \
    -d "{
      \"ip\": \"$ip\",
      \"username\": \"admin\",
      \"password\": \"default\",
      \"wg_peer_ip\": \"10.0.0.$(echo $ip | cut -d'.' -f4)\"
    }" &
done

wait

# Now check all statuses
for ip in "${ROUTERS[@]}"; do
  router_id=$(sqlite3 routers.db "SELECT id FROM routers WHERE ip='$ip' LIMIT 1")
  echo "=== $ip ($router_id) ==="
  curl http://localhost:8000/routers/$router_id/status | jq .state
done
```

**All 5 routers onboard in parallel.** Typical time: 30–120 seconds (not 5× the single-router time).

---

## Database Operations

### View All Routers

```bash
sqlite3 routers.db "SELECT id, ip, state, error FROM routers;"
```

### View Logs for a Router

```bash
sqlite3 routers.db "SELECT step, status, message, created_at FROM onboarding_logs WHERE router_id='192.168.1.1_abc12345' ORDER BY created_at;"
```

### Reset a Router (Clear and Retry)

```bash
sqlite3 routers.db "DELETE FROM routers WHERE id='192.168.1.1_abc12345'; DELETE FROM onboarding_logs WHERE router_id='192.168.1.1_abc12345';"
```

Then resubmit onboarding request.

---

## Production Deployment

### Systemd Service (Linux)

Create `/etc/systemd/system/mikrotik-provisioner.service`:

```ini
[Unit]
Description=MikroTik Provisioning Backend
After=network.target

[Service]
Type=simple
User=provisioner
WorkingDirectory=/opt/mikrotik-provisioner
Environment="PORT=8000"
Environment="BACKEND_WG_PUBKEY=..."
Environment="ENCRYPTION_KEY=..."
ExecStart=/usr/bin/python3 /opt/mikrotik-provisioner/main.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable mikrotik-provisioner
sudo systemctl start mikrotik-provisioner
```

### Docker

Create `Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py .

ENV PORT=8000
CMD ["python", "main.py"]
```

Build and run:

```bash
docker build -t mikrotik-provisioner .
docker run -d \
  -p 8000:8000 \
  -e BACKEND_WG_PUBKEY="..." \
  -e ENCRYPTION_KEY="..." \
  -v /data:/app/data \
  --name provisioner \
  mikrotik-provisioner
```

### Nginx Reverse Proxy

```nginx
upstream provisioner {
    server localhost:8000;
}

server {
    listen 80;
    server_name provisioner.example.com;

    location / {
        proxy_pass http://provisioner;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

---

## Monitoring

### Key Metrics (Basic)

1. **Request Rate:** Count `POST /routers/onboard` calls.
2. **Success Rate:** Count routers in state `DONE` vs `ERROR`.
3. **Onboarding Duration:** `updated_at - created_at` for each router.
4. **Error Rate by Step:** Count failed steps from `onboarding_logs`.

### Basic Logging Script

```bash
#!/bin/bash
# Monitor onboarding in real-time

watch -n 2 'sqlite3 routers.db "SELECT state, COUNT(*) FROM routers GROUP BY state;"'
```

### Alerting (Optional)

```bash
#!/bin/bash
# Alert if >5 routers in ERROR state

ERROR_COUNT=$(sqlite3 routers.db "SELECT COUNT(*) FROM routers WHERE state='ERROR';")
if [ $ERROR_COUNT -gt 5 ]; then
  echo "ALERT: $ERROR_COUNT routers failed" | mail -s "Provisioner Alert" ops@example.com
fi
```

Run as cron job:

```cron
*/5 * * * * /opt/mikrotik-provisioner/check_errors.sh
```

---

## Troubleshooting

### Issue: Routers Stuck in `API_OK`

**Symptom:** State never progresses beyond `API_OK`.

**Check:**
```bash
sqlite3 routers.db "SELECT step, status, message FROM onboarding_logs WHERE router_id='...' ORDER BY created_at DESC LIMIT 5;"
```

**Likely causes:**
- `create_wg_mgmt_interface()` failing silently.
- RouterOS version incompatibility (check `/system/identity/print` for version).

**Fix:**
- Check RouterOS logs on router: `log print recent=10`
- Try manual WireGuard setup on router to validate API access.

### Issue: Tunnel Handshake Timeout

**Symptom:** State reaches `TUNNEL_UP` then gets stuck.

**Check:**
```bash
# On router: check if tunnel actually has endpoint
ssh admin@192.168.1.1 'interface wireguard print'
```

**Likely causes:**
- Backend not reachable from router's network.
- Firewall blocking WireGuard UDP traffic (port 51820).

**Fix:**
- Check backend's WireGuard interface is up: `ip link show wg0`
- Verify peer was added: `wg show wg0`
- Test connectivity: `ping -I wg0 10.0.0.2`

### Issue: Password Rotation Fails

**Symptom:** State reaches `LOCKED` then errors on password rotation.

**Check:**
```bash
sqlite3 routers.db "SELECT error FROM routers WHERE id='...'"
```

**Likely causes:**
- Admin username is different (e.g., custom user).
- RouterOS version doesn't support `/user/set` API.

**Fix:**
- Verify admin user exists: `ssh admin@192.168.1.1 'user print'`
- Try manual password change via API to debug.

---

## Database Backup

```bash
# Backup database and logs
sqlite3 routers.db ".backup /backups/routers_$(date +%Y%m%d_%H%M%S).db"

# Or use cron
0 2 * * * sqlite3 /opt/mikrotik-provisioner/routers.db ".backup /backups/routers_$(date +\%Y\%m\%d).db"
```

---

## Next Steps

1. **Encryption:** Replace placeholder encryption in `models.py` with `cryptography.fernet.Fernet`.
2. **Secrets Management:** Use environment variables or `.env` file (keep `.env` in `.gitignore`).
3. **Monitoring:** Add Prometheus metrics (optional).
4. **Tests:** Write integration tests using `pytest` + test routers (optional for MVP).
5. **Docs:** Generate OpenAPI docs at `http://localhost:8000/docs` (automatic with FastAPI).
