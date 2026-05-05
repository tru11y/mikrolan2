# MikroTik Onboarding System - Deployment & Architecture

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MOBILE APP (iOS/Android)                     │
│  - User taps "Add Router"                                           │
│  - Enters router IP, admin user, admin pass                        │
│  - Sends to Backend API (HTTPS)                                    │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ├─── HTTPS + API Key + Signature
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│                  BACKEND API SERVICE (Python/FastAPI)               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ POST /routers/onboard                                       │   │
│  │ {                                                           │   │
│  │   "router_ip": "192.168.1.1",                             │   │
│  │   "admin_user": "admin",                                   │   │
│  │   "admin_pass": "...", (encrypted)                         │   │
│  │   "location": "NYC Office"                                 │   │
│  │ }                                                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                         ↓                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ RouterOnboardingService (orchestrator)                      │   │
│  │ - State machine execution                                   │   │
│  │ - Error handling & retry logic                              │   │
│  │ - Audit logging                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                         ↓                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ RouterOS API Client (routeros_api)                          │   │
│  │ - /system/identity, /interface/wireguard, etc.             │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────┬────────────────────┬───────────────────────────┬┘
                   │                    │                           │
          Port 8729 (API)    Port 51820 (WireGuard)      Vault/KMS
                   │                    │                           │
┌──────────────────▼──────────────────▼───────────────────────────▬─┐
│                          ROUTER (MikroTik)                         │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ RouterOS v7.x                                             │    │
│  │ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │    │
│  │ │  ether1 (WAN)│  │ ether2 (LAN) │  │ wg-mgmt (TUN)│     │    │
│  │ │ 203.0.113.50 │  │ 192.168.1.1  │  │ 10.255.0.2   │     │    │
│  │ └──────────────┘  └──────────────┘  └──────────────┘     │    │
│  │                                                            │    │
│  │ - API accessible only on wg-mgmt interface               │    │
│  │ - WireGuard tunnel UP to backend                          │    │
│  │ - Admin credentials rotated                               │    │
│  │ - HTTP, WinBox disabled                                  │    │
│  └───────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### PostgreSQL Tables

#### 1. Routers Table

```sql
CREATE TABLE routers (
    router_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identity
    name VARCHAR(255) NOT NULL,           -- Display name (user provided)
    identity VARCHAR(255),                -- From /system/identity
    
    -- Location & Contact
    location VARCHAR(255),
    contact_phone VARCHAR(20),
    contact_email VARCHAR(255),
    
    -- Provisioning Status
    status VARCHAR(50) NOT NULL DEFAULT 'discovered',
        -- discovered | credential_accepted | wg_interface_created |
        -- wg_tunnel_setup | tunnel_verified | hardened | provisioned | error
    
    status_details JSONB,                 -- Latest error or detail
    
    -- Networking
    ip_address INET NOT NULL,             -- Router LAN IP (initial connection)
    tunnel_ip INET,                       -- Router's WireGuard IP (10.255.0.x)
    RouterOS_version VARCHAR(50),
    
    -- Provisioning Timeline
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    discovered_at TIMESTAMP,
    credential_accepted_at TIMESTAMP,
    provisioned_at TIMESTAMP,
    
    -- Metadata
    api_port INT DEFAULT 8729,
    wg_port INT DEFAULT 51820,
    
    -- Soft delete
    deleted_at TIMESTAMP,
    
    CONSTRAINT router_ip_unique WHEN (deleted_at IS NULL) UNIQUE(ip_address)
);

CREATE INDEX idx_routers_status ON routers(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_routers_created ON routers(created_at DESC);
CREATE INDEX idx_routers_tunnel_ip ON routers(tunnel_ip) WHERE tunnel_ip IS NOT NULL;
```

#### 2. Onboarding Events (Audit Trail)

```sql
CREATE TABLE onboarding_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    router_id UUID NOT NULL REFERENCES routers(router_id) ON DELETE CASCADE,
    
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    from_state VARCHAR(50),
    to_state VARCHAR(50) NOT NULL,
    
    error_message TEXT,
    error_type VARCHAR(100),              -- "CredentialError", "RetryableError", etc.
    
    retry_count INT DEFAULT 0,
    
    duration_ms INT,                      -- How long this phase took
    
    context JSONB                         -- Additional debugging info
);

CREATE INDEX idx_events_router ON onboarding_events(router_id);
CREATE INDEX idx_events_timestamp ON onboarding_events(timestamp DESC);
CREATE INDEX idx_events_state ON onboarding_events(to_state);
```

#### 3. WireGuard Configuration

```sql
CREATE TABLE router_wireguard (
    router_id UUID UNIQUE NOT NULL REFERENCES routers(router_id) ON DELETE CASCADE,
    
    -- Router's WireGuard keys
    router_public_key VARCHAR(44) NOT NULL,      -- Base64, 44 chars
    router_tunnel_ip INET NOT NULL,              -- 10.255.0.x/32
    
    -- Backend configuration
    backend_public_key VARCHAR(44) NOT NULL,
    backend_tunnel_ip INET NOT NULL DEFAULT '10.255.0.1/32',
    backend_endpoint_ip INET NOT NULL,           -- Backend public IP
    
    -- Statistics
    latest_handshake TIMESTAMP,
    bytes_received BIGINT DEFAULT 0,
    bytes_sent BIGINT DEFAULT 0,
    last_health_check TIMESTAMP,
    
    -- Metadata
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_rotation TIMESTAMP,                     -- Key rotation timestamp
    
    PRIMARY KEY (router_id)
);

CREATE INDEX idx_wg_handshake ON router_wireguard(latest_handshake DESC);
```

#### 4. Encrypted Credentials

```sql
-- Credentials stored encrypted with customer's KMS key
CREATE TABLE router_credentials (
    router_id UUID UNIQUE NOT NULL REFERENCES routers(router_id) ON DELETE CASCADE,
    
    -- Encrypted with KMS master key
    encrypted_admin_username BYTEA NOT NULL,
    encrypted_admin_password BYTEA NOT NULL,
    
    -- Metadata
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rotated_at TIMESTAMP,
    
    -- For key derivation/versioning
    kms_key_id VARCHAR(255),                     -- Which KMS key was used
    
    PRIMARY KEY (router_id)
);
```

#### 5. Audit Log (Compliance)

```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Who performed the action
    actor VARCHAR(255) NOT NULL,                 -- "system", "admin@example.com", "api"
    actor_ip INET,
    
    -- What action
    action VARCHAR(100) NOT NULL,                -- "login", "provision", "config_change"
    resource_type VARCHAR(50),                   -- "router", "credential"
    resource_id UUID,                            -- router_id
    
    -- Result
    status VARCHAR(50),                          -- "success", "failure"
    status_message TEXT,
    
    -- Detailed changes
    changes JSONB                                -- Before/after for sensitive ops
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_router ON audit_log(resource_id);
```

---

## Secret Management (KMS/Vault)

### Credential Encryption Pattern

```python
from cryptography.fernet import Fernet
import os

class VaultService:
    """Integration with HashiCorp Vault or AWS KMS."""
    
    async def encrypt_credentials(self, username: str, password: str) -> tuple:
        """
        Encrypt router credentials using KMS.
        
        Process:
        1. Get data key from KMS (or envelope encryption)
        2. Encrypt username + password
        3. Store encrypted blob in PostgreSQL
        """
        kms = self.get_kms_client()
        
        plaintext = f"{username}:{password}"
        
        # AWS KMS example
        response = kms.encrypt(
            KeyId='arn:aws:kms:us-east-1:123456789012:key/12345678...',
            Plaintext=plaintext.encode()
        )
        
        return response['CiphertextBlob']
    
    async def decrypt_credentials(self, ciphertext: bytes) -> tuple:
        """Decrypt for API access."""
        kms = self.get_kms_client()
        
        response = kms.decrypt(CiphertextBlob=ciphertext)
        plaintext = response['Plaintext'].decode()
        
        username, password = plaintext.split(':', 1)
        return username, password
```

**Never**:
- Store plaintext passwords in database
- Log credentials
- Pass credentials in logs or error messages
- Keep decrypted credentials in memory longer than needed

**Do**:
- Use envelope encryption (rotate data keys frequently)
- Audit all credential access
- Rotate credentials every 90 days
- Use separate KMS keys per environment (dev, staging, prod)

---

## Deployment Environment

### Requirements

```
Operating System:
  - Linux (Ubuntu 20.04+) or any OS supporting Python 3.9+
  - 2+ CPU cores
  - 4GB RAM minimum (2GB for Python, 2GB for PostgreSQL)

Database:
  - PostgreSQL 12+
  - Storage: 100GB initial (1GB per 100k routers provisioned)
  - Replication: Multi-AZ for HA

Secret Management:
  - HashiCorp Vault (recommended) or AWS Secrets Manager / KMS
  
API Server:
  - Python 3.9+ with FastAPI
  - 4 worker processes (uvicorn)
  - Rate limiting: 5 onboardings/minute/IP
  
WireGuard:
  - WireGuard kernel module or wireguard-go
  - One tunnel interface per backend: wg-backend
  - IP range: 10.255.0.0/24 (up to 254 routers)

Monitoring:
  - Prometheus for metrics
  - Grafana for dashboards
  - Datadog/NewRelic optional
```

---

## FastAPI Backend Implementation Skeleton

```python
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
import hashlib
import hmac

app = FastAPI(title="MikroTik Router Onboarding")

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],
    allow_credentials=True,
)

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Services
onboarding_service = RouterOnboardingService(
    repository=PostgresRepository(),
    vault=HashiCorpVault(),
    logger=logger
)

# Dependency: API Key validation
async def verify_api_key(request: Request, x_api_key: str) -> str:
    """Verify mobile app's API key."""
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing API key")
    
    # Check against database
    key_hash = hashlib.sha256(x_api_key.encode()).hexdigest()
    if not db.api_key_exists(key_hash):
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    return x_api_key

# Dependency: Request signature validation
async def verify_request_signature(request: Request) -> None:
    """
    Verify request was signed by mobile app.
    
    Header: X-Signature: base64(HMAC-SHA256(body, secret))
    """
    signature = request.headers.get('X-Signature')
    body = await request.body()
    
    expected = hmac.new(
        key=os.getenv('MOBILE_APP_SECRET').encode(),
        msg=body,
        digestmod='sha256'
    ).digest()
    
    if signature != base64.b64encode(expected).decode():
        raise HTTPException(status_code=403, detail="Invalid signature")

# Endpoint: Onboard router
@app.post("/api/v1/routers/onboard")
async def onboard_router(
    request: Request,
    api_key: str = Depends(verify_api_key),
):
    """
    Initiate router onboarding.
    
    Request body:
    {
        "router_ip": "192.168.1.1",
        "admin_user": "admin",
        "admin_pass": "...",        // Should be encrypted on client
        "location": "NYC Office",
        "contact_phone": "+1-555-0100"
    }
    
    Returns:
    {
        "router_id": "550e8400-e29b-41d4-a716-446655440000",
        "status": "provisioning",
        "message": "Router onboarding started"
    }
    """
    
    try:
        data = await request.json()
        
        # Validate input
        if not data.get('router_ip'):
            raise HTTPException(status_code=400, detail="router_ip required")
        
        router_config = RouterConfig(
            router_id=str(uuid4()),
            ip_address=data['router_ip'],
            admin_user=data['admin_user'],
            admin_pass=data['admin_pass'],
            location=data.get('location', ''),
            contact_phone=data.get('contact_phone', '')
        )
        
        backend_config = BackendConfig(
            public_ip=os.getenv('BACKEND_PUBLIC_IP'),
            wg_private_key=os.getenv('WG_PRIVATE_KEY'),
            wg_public_key=os.getenv('WG_PUBLIC_KEY'),
        )
        
        # Start provisioning (async/background)
        result = await onboarding_service.provision(
            router_config, backend_config
        )
        
        # Log to audit trail
        logger.info(
            f"Onboarding started: {router_config.router_id} "
            f"from {request.client.host}"
        )
        
        return {
            "router_id": router_config.router_id,
            "status": "provisioning",
            "message": "Router onboarding started"
        }
    
    except Exception as e:
        logger.error(f"Onboarding request failed: {e}")
        raise HTTPException(status_code=500, detail="Internal error")

# Endpoint: Check provisioning status
@app.get("/api/v1/routers/{router_id}/status")
async def get_router_status(
    router_id: str,
    api_key: str = Depends(verify_api_key)
):
    """
    Poll provisioning status.
    
    Returns:
    {
        "router_id": "...",
        "status": "provisioned" | "error" | "provisioning",
        "state": "discovered" | "hardened" | "provisioned",
        "error": null | "error message"
    }
    """
    router = await db.get_router(router_id)
    if not router:
        raise HTTPException(status_code=404, detail="Router not found")
    
    return {
        "router_id": router_id,
        "status": "provisioned" if router['status'] == 'provisioned' else 'provisioning',
        "state": router['status'],
        "error": router.get('status_details', {}).get('error')
    }

# Endpoint: Health check
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "db": await db.health_check(),
        "vault": await vault.health_check()
    }

# Error handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"}
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, workers=4)
```

---

## Kubernetes Deployment (Optional)

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mikrotik-onboarding
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: mikrotik-onboarding
  template:
    metadata:
      labels:
        app: mikrotik-onboarding
    spec:
      containers:
      - name: onboarding-api
        image: registry.example.com/mikrotik-onboarding:v1.0.0
        ports:
        - containerPort: 8000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: postgres-url
        - name: VAULT_ADDR
          value: "https://vault.example.com"
        - name: VAULT_TOKEN
          valueFrom:
            secretKeyRef:
              name: vault-credentials
              key: token
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 5
          periodSeconds: 5
      imagePullSecrets:
      - name: registry-credentials
---
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: mikrotik-onboarding
  namespace: production
spec:
  selector:
    app: mikrotik-onboarding
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8000
  type: LoadBalancer
```

---

## Comparison to MikroTicket

### MikroTicket's Known Architecture

```
┌──────────────────────────┐
│   MikroTik Cloud (SaaS)   │  ← Proprietary cloud infrastructure
│  ├─ Router inventory      │
│  ├─ Config distribution   │
│  ├─ Firmware management   │
│  └─ Monitoring            │
└────────┬─────────────────┘
         │
    HTTPS REST API
         │
┌────────▼──────────────────┐
│  Mobile App (iOS/Android) │
│  ├─ QR code scanning      │
│  ├─ WireGuard setup       │
│  └─ Configuration wizard  │
└───────────────────────────┘
         │
    Initial tunnel setup
         │
┌────────▼──────────────────┐
│      MikroTik Router      │  ← Router reaches back to cloud
│  ├─ WireGuard initiated   │
│  ├─ Auto-configuration    │
│  └─ Cloud sync            │
└───────────────────────────┘
```

### Our System (Self-Hosted)

```
┌──────────────────────────┐
│   Your Backend (Custom)   │  ← Full control, your infrastructure
│  ├─ Router inventory      │
│  ├─ Config distribution   │
│  ├─ Audit logging         │
│  └─ Monitoring            │
└────────┬─────────────────┘
         │
    HTTPS API + RouterOS API
         │
┌────────▼──────────────────┐
│  Mobile App (iOS/Android) │
│  ├─ Credential entry      │
│  └─ Status polling        │
└───────────────────────────┘
         │
    Credentials only
         │
┌────────▼──────────────────┐
│      MikroTik Router      │  ← Backend connects in, tunnel initiates
│  ├─ WireGuard created     │
│  ├─ Backend peer added    │
│  └─ Auto-hardened        │
└───────────────────────────┘
```

### Key Differences

| Aspect | MikroTicket | Our System |
|--------|---|---|
| **Cloud** | Proprietary MikroTik SaaS | Your own backend |
| **Cost** | Per router per month | One-time setup + infra |
| **Control** | Limited to what MikroTicket offers | Full customization |
| **Data Residency** | MikroTik's servers | Your servers/on-prem |
| **API Protocol** | REST (if available) | RouterOS native API |
| **Scaling** | MikroTicket manages | You manage (PostgreSQL, K8s) |
| **Security Audit** | External dependency | Full visibility |
| **Integration** | Limited webhooks/APIs | Full custom integration |
| **Multi-tenancy** | Not supported | Custom implementation |

**When to use MikroTicket**: Small deployments, want SaaS simplicity, don't have dedicated ops team.

**When to use our system**: ISP-grade scale, need custom workflows, data sovereignty, cost efficiency at scale.

---

## Scaling Considerations

### Single Backend (MVP)

- 1 WireGuard tunnel (wg-backend)
- 1 backend IP + port 51820
- Handles ~100-500 routers
- Single point of failure

### Regional Backends (Production)

```
┌──────────────────────────────────────────────┐
│         DNS Load Balancer                    │
│  backend-us.example.com -> 203.0.113.1      │
│  backend-eu.example.com -> 205.0.114.1      │
│  backend-ap.example.com -> 206.0.115.1      │
└──────────────────────────────────────────────┘
         │            │            │
    ┌────▼─┐      ┌────▼─┐      ┌────▼─┐
    │ US   │      │ EU   │      │ APAC │
    │ 10.0 │      │ 10.1 │      │ 10.2 │
    │ .0.0 │      │ .0.0 │      │ .0.0 │
    │ /24  │      │ /24  │      │ /24  │
    └──────┘      └──────┘      └──────┘
    ~300 rts     ~300 rts      ~300 rts
```

**Benefits**:
- Geographic redundancy
- Reduced latency
- Independent scaling
- Regional failover

**Challenges**:
- WireGuard subnet management (no overlaps)
- Credentials per backend
- Monitoring complexity
- Cross-region HA

---

## Monitoring & Alerting

### Prometheus Metrics

```python
from prometheus_client import Counter, Gauge, Histogram

router_provisioning_started = Counter(
    'mikrotik_provisioning_started_total',
    'Routers started provisioning',
    ['region']
)

router_provisioning_completed = Counter(
    'mikrotik_provisioning_completed_total',
    'Routers completed provisioning',
    ['region', 'status']  # status: success, failed
)

provisioned_routers = Gauge(
    'mikrotik_routers_provisioned',
    'Total provisioned routers',
    ['region']
)

routers_in_error = Gauge(
    'mikrotik_routers_error',
    'Routers in error state',
    ['region', 'error_type']
)

provisioning_duration = Histogram(
    'mikrotik_provisioning_duration_seconds',
    'Time to provision router',
    ['phase']  # phase: credentials, wg_setup, hardening
)

tunnel_latency = Histogram(
    'mikrotik_tunnel_latency_ms',
    'WireGuard tunnel round-trip latency',
    ['router_id']
)

api_errors = Counter(
    'mikrotik_api_errors_total',
    'RouterOS API errors',
    ['endpoint', 'error_type']
)
```

### Grafana Dashboard Queries

```sql
-- Provisioning success rate (last hour)
rate(mikrotik_provisioning_completed_total{status="success"}[1h]) 
  / 
rate(mikrotik_provisioning_completed_total[1h])

-- Average provisioning time by phase
histogram_quantile(
  0.95,
  rate(mikrotik_provisioning_duration_seconds_bucket[5m])
)

-- Routers with stale tunnel handshakes
mikrotik_tunnel_latency > 5000

-- Error trend
rate(mikrotik_api_errors_total[5m])
```

---

## Production Deployment Checklist

- [ ] Database replicated across 2+ regions (HA)
- [ ] Vault/KMS configured with proper access controls
- [ ] API rate limiting enabled (5 onboardings/min per IP)
- [ ] HTTPS enforced (TLS 1.3 minimum)
- [ ] API signature verification enabled
- [ ] Audit logging to secure store (immutable)
- [ ] Monitoring and alerting configured
- [ ] Backup strategy (daily snapshots)
- [ ] Disaster recovery tested (RPO/RTO)
- [ ] Security scan passed (OWASP Top 10)
- [ ] Load testing completed (1000+ routers)
- [ ] Incident response plan in place
- [ ] Documentation complete
- [ ] Team training completed

---

## Support & Rollback

### Emergency Procedures

**Router unreachable**:
1. Check WireGuard tunnel status on backend
2. Verify firewall rules (UDP 51820)
3. Check router's public IP address
4. If unrecoverable: mark as error, notify ops

**Credential rotation needed**:
1. SSH via WireGuard to router
2. Use backup-admin credentials
3. Change admin password
4. Update vault with new password

**Mass rollback** (if critical bug found):
```bash
# Disable all new onboardings
UPDATE routers SET status='error' 
  WHERE status NOT IN ('provisioned', 'error');

# Disable backend service
docker-compose down

# Investigate
tail -f logs/onboarding.log

# Restart when safe
docker-compose up -d
```

---

## Cost Estimation (100k routers)

| Component | Cost/Year |
|---|---|
| Cloud infrastructure (AWS) | $50k |
| Database (RDS Multi-AZ) | $25k |
| WireGuard endpoints (3x) | $10k |
| Vault/KMS licensing | $5k |
| Monitoring (Datadog) | $10k |
| Personnel (2 DevOps) | $200k |
| **Total** | **$300k** |

**vs. MikroTicket**: ~$2-5/router/month = $200-500k/year for 100k routers

