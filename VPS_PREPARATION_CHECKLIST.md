# MikroLan VPS Preparation Checklist — V1 Production Backend

## 1. VPS ROLE IN THE SYSTEM

### Primary Responsibility
This VPS is a **MikroTik device provisioning backend** that acts as the authoritative control plane for the MikroLan SaaS platform. It is responsible for:
- Authenticating and managing operator accounts
- Storing provisioning templates and device configurations
- Coordinating with MikroTik devices to apply network policies
- Maintaining the audit trail of all provisioning changes
- Serving API requests from the mobile app and operator tools

### What This VPS Is NOT
- NOT a reverse proxy or load balancer
- NOT a file server or object storage
- NOT a monitoring/alerting system
- NOT a logging aggregation point
- NOT a CI/CD pipeline system
- NOT a message broker or queue system (V1)
- NOT a cache layer or in-memory store (V1)

---

## 2. MINIMAL SERVICES REQUIRED

### Core Services (Must Run)
1. **API Server** — REST/GraphQL backend service (single process, likely 8000-9000 port range)
2. **Database** — Persistent data store (PostgreSQL/MySQL/similar)
3. **TLS Certificate Handler** — Automatic renewal for HTTPS (systemd service or cron-based)

### Support Services (Must Run)
4. **SSH Server** — For operator/admin access (SSH on 22)
5. **System Logging** — syslog or equivalent (journald on systemd systems)
6. **Package Manager** — apt/yum for system updates

### Services That May Run
- **Reverse Proxy** — nginx/Apache for TLS termination + routing (optional, may be needed for V1)
- **Background Jobs** — If async processing is required (cron or systemd timer)

### Services That Must NOT Run
- ❌ X11/Desktop Environment
- ❌ GUI package managers
- ❌ Development tools (gcc, make, git, npm, pip)
- ❌ Web browsers, media players
- ❌ Unnecessary daemons (cups, avahi, etc.)

---

## 3. NETWORK EXPOSURE RULES

### What Must Be Publicly Reachable
| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| **443** | HTTPS | Mobile app clients + ISP operators | Backend API endpoint |
| **80** | HTTP | Anywhere | Certificate renewal challenges (ACME) only |

### What Must NOT Be Publicly Reachable
| Port | Protocol | Access | Reason |
|------|----------|--------|--------|
| **22** | SSH | Admin IPs only (VPN/bastion) | Prevent brute force |
| **5432/3306** | Database | Localhost only | Database is never exposed |
| **8000-9000** | Backend app | Localhost only | API should be behind TLS proxy |
| **25/587/465** | SMTP | Closed | No outbound email needed (V1) |
| **3389** | RDP | Closed | No Windows Remote Desktop |
| **Any other port** | Any | Closed | Default-deny all else |

### Network Architecture Assumptions
- VPS has a public static IP address
- Traffic to port 443 is encrypted with a valid TLS certificate
- Backend communicates with MikroTik devices on private network (firewall rule: outbound to MikroTik devices on port 8728/8729, only from this VPS)
- No direct communication from internet to database or internal services

---

## 4. SECURITY BASELINE

### System Hardening
- [ ] **OS**: Minimal Linux distribution (Debian/Ubuntu LTS or RHEL-based), fully patched
- [ ] **Kernel**: Latest stable kernel for the distribution
- [ ] **Filesystem**: `/` read-only where possible (e.g., via mount options); `/var` and `/tmp` with noexec
- [ ] **Services**: Only sshd, database, API, TLS handler, and systemd-journald running
- [ ] **Boot**: GRUB password set (optional but recommended for physical servers)

### User and Permissions
- [ ] **Root account**: SSH key only (no password login)
- [ ] **Application user**: Dedicated non-root user for API process (e.g., `appuser`)
- [ ] **Application user permissions**: Minimal (owns only app directories, cannot modify system files)
- [ ] **Sudo access**: Restricted to specific commands only, required for restarts
- [ ] **Home directories**: `/home/*` and `/root` inaccessible to other users (700 permissions)

### SSH Hardening
- [ ] **Root login**: Disabled (`PermitRootLogin no`)
- [ ] **Password authentication**: Disabled (`PasswordAuthentication no`)
- [ ] **Public key authentication**: Enabled, keys managed securely
- [ ] **Port 22**: Monitored (log failed attempts, rate-limit)
- [ ] **Key rotation**: Plan to rotate keys every 90 days

### Secrets Management
- [ ] **Database credentials**: Stored in `~appuser/.env` file (600 permissions, owned by appuser)
- [ ] **API keys/tokens**: Never hardcoded, always from environment variables
- [ ] **TLS certificates**: Stored in `/etc/ssl/certs/` with restricted permissions
- [ ] **Private keys**: `/etc/ssl/private/` (700), root-owned only
- [ ] **Secrets rotation**: Database password rotation every 180 days (document procedure)
- [ ] **No secrets in logs**: Ensure API server strips sensitive data from all log output
- [ ] **No secrets in git**: `.env`, `.pem`, `.key` files must never be committed

### Firewall (iptables/nftables or firewall service)
- [ ] **Default policy**: Deny all inbound, allow all outbound
- [ ] **HTTP (80)**: Allow from anywhere (for ACME challenges only)
- [ ] **HTTPS (443)**: Allow from anywhere
- [ ] **SSH (22)**: Allow from specific IPs only (VPN gateway, bastion host)
- [ ] **Loopback**: Allow all (127.0.0.1)
- [ ] **Outbound MikroTik**: Allow only to specific MikroTik device IPs (port 8728/8729)
- [ ] **Outbound NTP/DNS**: Allow to configured servers only
- [ ] **Logging**: Log all dropped connections to syslog (but not noisy)

### TLS/HTTPS
- [ ] **Certificate**: Valid domain, issued by trusted CA
- [ ] **Self-signed**: Forbidden for production
- [ ] **Certificate renewal**: Automated (e.g., Let's Encrypt with auto-renewal)
- [ ] **Renewal monitoring**: Alert if renewal fails (check logs weekly)
- [ ] **TLS version**: 1.2 or higher only
- [ ] **Ciphers**: Strong ciphers only (no NULL, RC4, DES, MD5)
- [ ] **HSTS header**: Set on API responses (Strict-Transport-Security)

### Database Security
- [ ] **Database user**: Non-root dedicated account (e.g., `dbuser`)
- [ ] **Root/admin password**: Strong (16+ chars, random), stored securely
- [ ] **Connection**: TLS between API and database (if on same host, use Unix socket)
- [ ] **Backups**: Encrypted, stored off-system (separate storage)
- [ ] **Backup retention**: Daily for 7 days, weekly for 4 weeks, monthly for 12 months (or per compliance)
- [ ] **Backup testing**: Restore from backup monthly to verify integrity

### Logging and Audit
- [ ] **SSH logins**: All logged (journal, forwarded to external syslog)
- [ ] **API errors**: Logged with timestamp, user context (no passwords)
- [ ] **Database queries**: Not logged by default (performance), but access logs on user activity
- [ ] **System events**: File modifications on critical paths logged (auditd)
- [ ] **Log retention**: Minimum 90 days locally, offsite backup for 1 year
- [ ] **Log aggregation**: Plan for central log server (future, not V1)

### Access Control
- [ ] **API authentication**: All requests authenticated (token/session-based)
- [ ] **Rate limiting**: Enabled on API (per IP, per user)
- [ ] **CORS policy**: Restrict to known mobile app domains only
- [ ] **Admin panel access**: If exists, require MFA (V1+ requirement)
- [ ] **Service account isolation**: No shared passwords between services

---

## 5. HOW CLIENTS ACCESS THE BACKEND

### Mobile App Access
- **Protocol**: HTTPS only (TLS 1.2+)
- **Endpoint**: `api.mikrolan.{domain}:443/v1/`
- **Authentication**: JWT tokens or session cookies (set by login endpoint)
- **Flow**:
  1. Mobile app sends login credentials to `POST /v1/auth/login`
  2. Backend validates against database, returns access token
  3. Mobile app includes token in `Authorization: Bearer <token>` header
  4. Backend validates token, serves API response
  5. Token expiration: Refresh token mechanism required (access token valid 1 hour, refresh token 30 days)
- **Device provisioning flow**:
  1. Operator selects devices to configure in mobile app
  2. Mobile app calls `POST /v1/devices/{id}/apply-config`
  3. Backend validates request, stores configuration, queues provisioning job
  4. Backend communicates directly with MikroTik devices (not through app)
  5. Backend returns status to mobile app via polling or webhook

### Operator Access
- **Protocol**: HTTPS only
- **Authentication**: Email + password (with MFA in V1+) or API key
- **Endpoints**: Same as mobile app (shared backend)
- **Additional endpoints**: Admin panel (if separate frontend exists, runs on separate VPS)
- **Expected operators**: ISP staff, likely 1-20 per customer (not thousands)

### MikroTik Device Communication
- **Direction**: Backend → MikroTik devices (backend initiates)
- **Protocol**: RouterOS API (port 8728 unencrypted or 8729 TLS)
- **Authentication**: Device-specific credentials stored in backend database
- **Network**: Private network only (devices not accessible from internet)
- **Flow**:
  1. Backend fetches provisioning job from queue
  2. Connects to target MikroTik device
  3. Authenticates with stored device credentials
  4. Pushes configuration commands
  5. Logs success/failure
  6. Reports result back to database (for mobile app to query)

---

## 6. WHAT MUST NEVER BE INSTALLED (V1)

### Technology Restrictions
- ❌ **Kubernetes/Docker Orchestration** — Not needed for single VPS, adds complexity
- ❌ **Distributed cache** (Redis, Memcached) — Use local memory or database for V1
- ❌ **Message queues** (RabbitMQ, Kafka) — Use database-backed job queue or systemd timers
- ❌ **Monitoring tools** (Prometheus, Grafana) — Use simple cron alerts and log monitoring
- ❌ **Service mesh** (Istio, Linkerd) — Not applicable to single VPS
- ❌ **Multiple application servers** (Gunicorn, PM2 cluster) — Run single process, restart on failure
- ❌ **Load balancer** — Only one VPS, reverse proxy at TLS layer
- ❌ **Complicated deployment tools** (Ansible, Terraform for this server) — Use systemd and shell scripts
- ❌ **Multiple environments** — Single VPS = production only

### Dependency Restrictions
- ❌ **Development libraries** — No gcc, make, build-essential installed
- ❌ **Languages not in use** — If backend is Python, no Node.js/Ruby/Go installed
- ❌ **Package managers beyond system** — No npm, pip, gem left accessible
- ❌ **Version managers** — No nvm, rbenv, asdf (build once, deploy binary or minimal runtime)
- ❌ **X11/graphical libraries** — No display servers, no libx11
- ❌ **Mail server** — No postfix/sendmail (no email needed, alerts via HTTP webhooks if required)

### Feature Restrictions for V1
- ❌ **OAuth/SSO integration** — Use internal auth first, add later
- ❌ **Webhook signed deliveries** — Not needed until mobile app calls webhooks
- ❌ **Rate limiting per user role** — Implement simple per-IP first
- ❌ **Multi-tenant isolation** — Assume single customer per VPS for V1
- ❌ **Database failover/replication** — Single database instance only
- ❌ **Automated rollback** — Manual rollback procedure (documented)
- ❌ **Blue-green deployments** — Use simple rolling restart (planned downtime acceptable)

---

## 7. DEPLOYMENT AND STARTUP

### Application Startup
- **Method**: systemd service unit (not manual, not cron @reboot)
- **Service user**: Runs as `appuser` (non-root)
- **Working directory**: `/opt/mikrolan/` or `/app/`
- **Restart policy**: Automatic restart on failure (after 5s delay)
- **Startup timeout**: 30 seconds (fail if not listening within 30s)
- **Shutdown grace period**: 10 seconds (kill after 10s if not responsive)

### Database Startup
- **Method**: systemd service (PostgreSQL/MySQL managed by system)
- **Startup order**: Database starts before API service
- **Health check**: API service waits for database to be ready before starting
- **Startup timeout**: 60 seconds

### Configuration Management
- **Environment file**: `/etc/default/mikrolan` (readable by appuser)
- **Database connection string**: Environment variable, not config file
- **API listening port**: Environment variable (default 8000)
- **TLS cert path**: Environment variable or hardcoded to `/etc/ssl/certs/`
- **No dynamic config reloading**: Restart required for any change (simple model for V1)

---

## 8. OPERATIONS AND MAINTENANCE

### Backup Strategy
- **What to backup**: Database (full), configuration files (/etc/), application code
- **What NOT to backup**: Node modules, build artifacts, logs (keep 90 days inline, archive offline)
- **Backup frequency**: Daily automated, tested weekly
- **Backup location**: Separate storage (S3, NFS, other VPS — not local)
- **Recovery objective**: RTO 1 hour, RPO 1 day

### Updates and Patching
- **OS patches**: Applied automatically (unattended-upgrades or similar)
- **Security patches**: Applied within 24 hours of release
- **Application updates**: Manual (pull code, test locally, deploy during planned window)
- **Scheduled maintenance window**: Every 2 weeks, 2-hour window, after-hours

### Monitoring and Alerting
- **Metrics**: Check every 5 minutes
  - API process is running (systemctl status)
  - Database is responding (simple query)
  - Disk space > 20% free
  - CPU < 80% sustained
  - Memory < 85% used
- **Alert channels**: Email (critical), log file (all)
- **Alert response**: On-call engineer acknowledges within 15 minutes (SLA for V1)
- **No external monitoring service** (V1) — Use local cron scripts and syslog

### Troubleshooting Access
- **SSH access**: From bastion/VPN only, logged
- **Sudo access**: For service restarts and log access only
- **Database access**: Via application-user credentials only, never root password shared
- **Secrets**: Never exposed in troubleshooting output (logs redacted)

---

## 9. COMPLIANCE AND DOCUMENTATION

### Required Documentation (Stored in Git)
- [ ] Network diagram (cloud provider topology)
- [ ] Firewall rules (iptables config or equivalent)
- [ ] Systemd service files (both API and database)
- [ ] Environment variable reference (no actual values)
- [ ] Backup and restore procedures (step-by-step)
- [ ] Emergency contacts (on-call rotation)
- [ ] Password rotation schedule (who, when, how)
- [ ] Data retention policy (logs, backups, user data)

### Required Runbooks (Shared with team)
- [ ] How to restart the API service
- [ ] How to restore from backup
- [ ] How to rotate database password
- [ ] How to update TLS certificate manually
- [ ] How to SSH to production VPS
- [ ] How to read logs (journalctl commands)
- [ ] How to check database health

### Data Handling
- **Data classification**: MikroTik device configs = sensitive, operator credentials = sensitive
- **Encryption at rest**: Enabled on database (if available from provider)
- **Encryption in transit**: HTTPS for all external traffic, TLS between app and database
- **Access logs**: Retained for 6 months (audit purposes)
- **User data**: Can be deleted (GDPR delete endpoint), backups kept per retention policy

---

## 10. CHECKLIST FOR LAUNCH

- [ ] OS installed, security updates applied
- [ ] Firewall configured (deny by default, allow 80/443/22)
- [ ] SSH hardened (no password, no root login, key-based only)
- [ ] Application user created (`appuser`, no shell access)
- [ ] Database installed and secured
- [ ] TLS certificate obtained and installed
- [ ] API application code deployed to `/opt/mikrolan/`
- [ ] Systemd service files created and tested (manual start works)
- [ ] Database automatically starts before API
- [ ] API automatically restarts on failure
- [ ] Environment variables set for API and database
- [ ] Backup script created and tested (restore tested)
- [ ] Monitoring/alerting script deployed (local cron)
- [ ] Logs configured (journal forwarding or syslog)
- [ ] Documentation reviewed and shared with team
- [ ] Emergency contacts and runbooks prepared
- [ ] API endpoint health-check tested from external IP
- [ ] Mobile app can successfully authenticate and call API
- [ ] Database can handle load test (simulated operators)
- [ ] Backup and restore tested end-to-end
- [ ] Team trained on restart and troubleshooting procedures

---

## 11. DECISION RECORD

### Why Single VPS for V1?
- **Simplicity**: Easier to secure, monitor, and troubleshoot
- **Cost**: Minimal overhead, suitable for 1-10 ISP customers
- **Risk**: Single point of failure (acceptable for V1 with daily backups)
- **Upgrade path**: Add load balancer, second VPS, or Kubernetes in V2

### Why No Redis/Cache?
- **Justification**: Single VPS can handle API load without cache, database is fast enough
- **Limit**: Expect <100 RPS (requests/second) for reasonable ISP operations
- **Upgrade**: Add Redis if API response time > 500ms under load

### Why No Queue System?
- **Justification**: MikroTik provisioning is typically sequential, not high-throughput
- **Method**: Database job queue (simple table with status column)
- **Upgrade**: Add Celery/RQ if provisioning takes > 5 seconds per device

### Why Manual Deployments?
- **Justification**: Single VPS, infrequent updates (weekly at most)
- **Method**: Git pull, restart systemd service
- **Upgrade**: Add CI/CD pipeline in V1.5 when deployment frequency increases

