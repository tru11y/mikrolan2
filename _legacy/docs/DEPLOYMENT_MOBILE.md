# MikroLan Mobile App - Deployment Instructions

## FINAL URL
**http://149.28.232.230:8080**

## Files
- `app.html` — Mobile web application
- `mikrolan-mobile.service` — systemd service definition

## Deployment Steps (Execute on VPS)

### 1. Create Directory Structure
```bash
mkdir -p /opt/mikrolan/mobile
```

### 2. Copy Application Files
```bash
cp app.html /opt/mikrolan/mobile/app.html
```

Alternatively, serve as `index.html`:
```bash
cp app.html /opt/mikrolan/mobile/index.html
```

### 3. Deploy systemd Service
```bash
cp mikrolan-mobile.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable mikrolan-mobile.service
systemctl start mikrolan-mobile.service
```

### 4. Verify Service
```bash
systemctl status mikrolan-mobile.service
curl http://localhost:8080/app.html
```

### 5. Test from Phone Browser
Open: **http://149.28.232.230:8080/app.html**

Or if using index.html:
**http://149.28.232.230:8080/**

## Service Management

### Check Status
```bash
systemctl status mikrolan-mobile.service
```

### View Logs
```bash
journalctl -u mikrolan-mobile.service -f
```

### Restart Service
```bash
systemctl restart mikrolan-mobile.service
```

### Stop Service
```bash
systemctl stop mikrolan-mobile.service
```

## Features

✓ Onboard single routers with IP, username, password, VPN mode, config
✓ Real-time status polling
✓ View onboarding logs
✓ Retry failed onboardings
✓ Browse all onboarded routers
✓ Mobile-responsive UI
✓ Auto-start on reboot
✓ Survives crashes (systemd auto-restart)

## API Endpoints Used

The app communicates with:
- `POST /routers/onboard` — Start onboarding
- `GET /routers/{router_id}/status` — Check status
- `POST /routers/{router_id}/retry` — Retry failed onboarding
- `GET /routers` — List all routers (status tab)

Backend must be running at: **http://149.28.232.230:8000**

## Troubleshooting

### Service won't start
```bash
journalctl -u mikrolan-mobile.service -n 50
```

### Port 8080 already in use
Change port in service file `/etc/systemd/system/mikrolan-mobile.service`:
```ini
ExecStart=/usr/bin/python3 -m http.server 9090 --directory /opt/mikrolan/mobile
```

### Can't access from phone
1. Verify VPS firewall allows port 8080
2. Test locally: `curl http://149.28.232.230:8080`
3. Check service status: `systemctl status mikrolan-mobile.service`
4. Verify app.html exists: `ls -la /opt/mikrolan/mobile/`

### Backend API not responding
1. Verify backend is running: `curl http://149.28.232.230:8000/health`
2. Check backend logs
3. Verify no firewall blocking 8000 port

## Notes

- Service auto-restarts if it crashes (RestartSec=10)
- Logs available via journalctl
- No manual intervention needed after deployment
- Survives VPS reboot automatically
