# RouterOS API Reference - Complete Command Reference

## Overview

This document provides exact RouterOS API commands (via port 8728/8729) for the automated onboarding system. All examples assume Python `routeros-api` library.

**Important**: These are API calls, NOT SSH commands. Use `/` notation for paths.

---

## 1. CREDENTIAL VALIDATION (Phase 1)

### 1.1 Test Admin Access - `/system/identity`

**Purpose**: Verify admin credentials work and get router identity.

**Command**:
```python
system_resource = api.get_resource('/system/identity')
identity = system_resource.get()
```

**Response**:
```python
[{
    '.id': '*1',
    'name': 'MikroTik-Router',
    'disabled': 'false'
}]
```

**Python Wrapper**:
```python
async def validate_admin_access(api_conn) -> dict:
    try:
        identity = api_conn.get_resource('/system/identity').get()
        if not identity:
            raise CredentialError("No identity returned")
        return {
            "router_name": identity[0].get('name', 'unknown'),
            "has_admin": True
        }
    except Exception as e:
        raise CredentialError(f"Admin access denied: {e}")
```

---

### 1.2 Check RouterOS Version - `/system/package`

**Purpose**: Verify RouterOS version compatibility (should be 6.43+).

**Command**:
```python
packages = api.get_resource('/system/package').get()
```

**Response**:
```python
[
    {'.id': '*0', 'name': 'routeros', 'version': '7.10.0', 'bundle': '1'},
    {'.id': '*1', 'name': 'system', 'version': '7.10.0', 'bundle': '1'},
    {'.id': '*2', 'name': 'wireless', 'version': '7.10.0', 'bundle': '1'},
    ...
]
```

**Python Wrapper**:
```python
async def check_version(api_conn) -> str:
    packages = api_conn.get_resource('/system/package').get()
    for pkg in packages:
        if pkg.get('name') == 'routeros':
            version = pkg.get('version', 'unknown')
            major_version = int(version.split('.')[0])
            if major_version < 6:
                raise OnboardingError(f"RouterOS {version} not supported (need 6.43+)")
            return version
    return 'unknown'
```

---

## 2. WIREGUARD INTERFACE CREATION (Phase 2)

### 2.1 Create WireGuard Interface - `/interface/wireguard`

**Purpose**: Create the `wg-mgmt` management interface.

**Idempotency Check**:
```python
def get_existing_wg_interface(api_conn):
    wg = api_conn.get_resource('/interface/wireguard')
    for iface in wg.get():
        if iface['name'] == 'wg-mgmt':
            return iface['.id']  # Exists
    return None
```

**Create Command** (if not exists):
```python
wg = api.get_resource('/interface/wireguard')
new_id = wg.add(
    name='wg-mgmt',
    listen_port='51820',
    mtu='1420',
    disabled='false'
)
```

**Response** (new ID):
```
*.5
```

**Fetch All Interfaces**:
```python
wg = api.get_resource('/interface/wireguard')
interfaces = wg.get()
```

**Response**:
```python
[{
    '.id': '*.5',
    '.nextid': '*.6',
    'name': 'wg-mgmt',
    'listen-port': '51820',
    'mtu': '1420',
    'disabled': 'false',
    'public-key': '1XQ53CfYH/AyDdWpTZXK0dVMdda9dqPcA3Gh1F8D4Bo=',
    'private-key': '(...hidden...)',
    'comment': ''
}]
```

**Python Wrapper**:
```python
async def ensure_wg_interface(api_conn) -> tuple[str, str]:
    """
    Get or create WireGuard interface.
    Returns: (interface_name, public_key)
    """
    wg = api_conn.get_resource('/interface/wireguard')
    
    # Check if exists
    for iface in wg.get():
        if iface['name'] == 'wg-mgmt':
            return (iface['name'], iface['public-key'])
    
    # Create if missing
    wg.add(
        name='wg-mgmt',
        listen_port='51820',
        mtu='1420',
        disabled='false'
    )
    
    # Fetch again to get public key
    for iface in wg.get():
        if iface['name'] == 'wg-mgmt':
            return (iface['name'], iface['public-key'])
    
    raise OnboardingError("WireGuard interface created but not found")
```

---

### 2.2 Get Router's WireGuard Public Key

**Command**:
```python
wg = api.get_resource('/interface/wireguard')
interfaces = wg.get()

for iface in interfaces:
    if iface['name'] == 'wg-mgmt':
        router_pubkey = iface['public-key']
        print(f"Router public key: {router_pubkey}")
```

**Example Output**:
```
Router public key: 1XQ53CfYH/AyDdWpTZXK0dVMdda9dqPcA3Gh1F8D4Bo=
```

---

## 3. WIREGUARD PEER CONFIGURATION (Phase 3)

### 3.1 Add Backend as WireGuard Peer - `/interface/wireguard/peers`

**Purpose**: Configure router to reach backend via WireGuard.

**Idempotency Check**:
```python
def peer_exists(api_conn, backend_ip: str) -> bool:
    peers = api_conn.get_resource('/interface/wireguard/peers')
    for peer in peers.get():
        if (peer.get('interface') == 'wg-mgmt' and 
            peer.get('endpoint-address') == backend_ip):
            return True
    return False
```

**Add Peer Command**:
```python
peers = api.get_resource('/interface/wireguard/peers')
new_id = peers.add(
    interface='wg-mgmt',
    public_key='backend_public_key_base64_here',
    endpoint_address='203.0.113.100',  # Backend public IP
    endpoint_port='51820',
    allowed_address='10.255.0.1/32',   # Backend's tunnel IP
    persistent_keepalive='25'           # Keep-alive every 25s
)
```

**Response** (new ID):
```
*.7
```

**Fetch All Peers**:
```python
peers = api.get_resource('/interface/wireguard/peers')
peer_list = peers.get()
```

**Response**:
```python
[{
    '.id': '*.7',
    '.nextid': '*.8',
    'interface': 'wg-mgmt',
    'public-key': '1XQ53CfYH/AyDdWpTZXK0dVMdda9dqPcA3Gh1F8D4Bo=',
    'endpoint-address': '203.0.113.100',
    'endpoint-port': '51820',
    'allowed-address': '10.255.0.1/32',
    'persistent-keepalive': '25',
    'disabled': 'false',
    'comment': ''
}]
```

**Python Wrapper**:
```python
async def ensure_wg_peer(
    api_conn,
    backend_ip: str,
    backend_pubkey: str
) -> bool:
    """Add backend as WireGuard peer (idempotent)."""
    peers = api_conn.get_resource('/interface/wireguard/peers')
    
    # Check if already exists
    for peer in peers.get():
        if (peer.get('interface') == 'wg-mgmt' and 
            peer.get('endpoint-address') == backend_ip and
            peer.get('public-key') == backend_pubkey):
            return True  # Already configured
    
    # Add new peer
    peers.add(
        interface='wg-mgmt',
        public_key=backend_pubkey,
        endpoint_address=backend_ip,
        endpoint_port='51820',
        allowed_address='10.255.0.1/32',
        persistent_keepalive='25'
    )
    
    return True
```

---

### 3.2 Assign IP Address to WireGuard Interface - `/ip/address`

**Purpose**: Assign `10.255.0.2/32` to router on WireGuard tunnel.

**Idempotency Check**:
```python
def ip_exists(api_conn, interface: str, address: str) -> bool:
    ip_resource = api_conn.get_resource('/ip/address')
    for addr in ip_resource.get():
        if (addr.get('interface') == interface and 
            addr.get('address') == address):
            return True
    return False
```

**Add IP Command**:
```python
ip_resource = api.get_resource('/ip/address')
new_id = ip_resource.add(
    address='10.255.0.2/32',
    interface='wg-mgmt'
)
```

**Response**:
```
*.8
```

**Fetch All Addresses**:
```python
ip_resource = api.get_resource('/ip/address')
addresses = ip_resource.get()
```

**Response**:
```python
[
    {
        '.id': '*.1',
        'address': '192.168.1.1/24',
        'interface': 'ether1',
        'network': '192.168.1.0',
        'disabled': 'false'
    },
    {
        '.id': '*.8',
        'address': '10.255.0.2/32',
        'interface': 'wg-mgmt',
        'network': '10.255.0.2',
        'disabled': 'false'
    }
]
```

**Python Wrapper**:
```python
async def ensure_ip_address(api_conn, interface: str, address: str) -> bool:
    """Assign IP address to interface (idempotent)."""
    ip_resource = api_conn.get_resource('/ip/address')
    
    # Check if already assigned
    for addr in ip_resource.get():
        if (addr.get('interface') == interface and 
            addr.get('address') == address):
            return True  # Already assigned
    
    # Assign IP
    ip_resource.add(address=address, interface=interface)
    return True
```

---

### 3.3 Enable WireGuard Interface - `/interface/wireguard` (modify)

**Purpose**: Bring up the WireGuard interface.

**Command**:
```python
wg = api.get_resource('/interface/wireguard')
interfaces = wg.get()

for iface in interfaces:
    if iface['name'] == 'wg-mgmt':
        wg.set(
            numbers=iface['.id'],
            disabled='false'
        )
        break
```

**Python Wrapper**:
```python
async def enable_wg_interface(api_conn) -> bool:
    """Enable WireGuard interface."""
    wg = api_conn.get_resource('/interface/wireguard')
    
    for iface in wg.get():
        if iface['name'] == 'wg-mgmt':
            wg.set(numbers=iface['.id'], disabled='false')
            return True
    
    raise OnboardingError("WireGuard interface not found")
```

---

## 4. TUNNEL VERIFICATION (Phase 4)

### 4.1 Monitor WireGuard Handshakes - `/interface/wireguard/peers/stats`

**Purpose**: Verify that the tunnel is active (latest handshake is recent).

**Command**:
```python
peers_stats = api.get_resource('/interface/wireguard/peers/stats')
stats = peers_stats.get()
```

**Response**:
```python
[{
    '.id': '*.7',
    'interface': 'wg-mgmt',
    'peer': 'wg-mgmt[*.7]',
    'endpoint-address': '203.0.113.100',
    'endpoint-port': '51820',
    'bytes-received': '1024000',
    'bytes-sent': '512000',
    'last-handshake': '5',  # seconds ago
    'persistent-keepalive': '25'
}]
```

**Python Wrapper**:
```python
async def verify_tunnel_up(api_conn, timeout_sec: int = 30) -> bool:
    """
    Wait for tunnel to come up by checking peer handshake.
    Returns True if tunnel is active.
    """
    import time
    
    for attempt in range(timeout_sec):
        try:
            peers_stats = api_conn.get_resource('/interface/wireguard/peers/stats')
            stats = peers_stats.get()
            
            for stat in stats:
                if stat.get('interface') == 'wg-mgmt':
                    last_handshake = int(stat.get('last-handshake', '999999'))
                    
                    # If handshake was within 30 seconds, tunnel is UP
                    if last_handshake < 30:
                        return True
        except Exception as e:
            print(f"Stats check failed: {e}")
        
        time.sleep(1)
    
    return False
```

---

## 5. SECURITY HARDENING (Phase 5)

### 5.1 Disable Insecure Services - `/ip/service`

**Purpose**: Disable HTTP, WinBox, and insecure API (port 8728).

**Fetch Services**:
```python
services = api.get_resource('/ip/service')
service_list = services.get()
```

**Response**:
```python
[
    {
        '.id': '*.1',
        'name': 'telnet',
        'port': '23',
        'address': '0.0.0.0',
        'disabled': 'true'
    },
    {
        '.id': '*.2',
        'name': 'ftp',
        'port': '21',
        'address': '0.0.0.0',
        'disabled': 'true'
    },
    {
        '.id': '*.3',
        'name': 'www',
        'port': '80',
        'address': '0.0.0.0',
        'disabled': 'false'  # We want to disable this
    },
    {
        '.id': '*.4',
        'name': 'ssh',
        'port': '22',
        'address': '0.0.0.0',
        'disabled': 'false'  # Keep this
    },
    {
        '.id': '*.5',
        'name': 'api',
        'port': '8728',
        'address': '0.0.0.0',
        'disabled': 'false'  # Disable this (insecure)
    },
    {
        '.id': '*.6',
        'name': 'api-ssl',
        'port': '8729',
        'address': '0.0.0.0',
        'disabled': 'false'  # Keep this
    },
    {
        '.id': '*.7',
        'name': 'winbox',
        'port': '8291',
        'address': '0.0.0.0',
        'disabled': 'false'  # Disable this
    }
]
```

**Disable Service Command**:
```python
services = api.get_resource('/ip/service')
service_list = services.get()

for service in service_list:
    service_name = service.get('name', '')
    service_id = service.get('.id', '')
    
    if service_name in ['www', 'api', 'winbox']:
        services.set(numbers=service_id, disabled='true')
        print(f"Disabled {service_name}")
```

**Python Wrapper**:
```python
async def disable_insecure_services(api_conn) -> list:
    """Disable HTTP, WinBox, and insecure API."""
    services = api_conn.get_resource('/ip/service')
    disabled = []
    
    for service in services.get():
        name = service.get('name', '')
        service_id = service.get('.id', '')
        
        if name in ['www', 'api', 'winbox']:
            services.set(numbers=service_id, disabled='true')
            disabled.append(name)
    
    return disabled
```

---

### 5.2 Restrict API to WireGuard Interface Only

**Command** (find and update API-SSL binding):
```python
services = api.get_resource('/ip/service')

for service in services.get():
    if service.get('name') == 'api-ssl' and service.get('port') == '8729':
        # Restrict to WireGuard interface only
        services.set(
            numbers=service.get('.id'),
            address='10.255.0.1'  # Backend's tunnel IP only
        )
        print("API-SSL now restricted to WireGuard")
```

---

### 5.3 Rotate Admin Password - `/user`

**Purpose**: Replace the initial password with a strong random password.

**Fetch Users**:
```python
users = api.get_resource('/user')
user_list = users.get()
```

**Response**:
```python
[{
    '.id': '*.1',
    'name': 'admin',
    'group': 'full',
    'address': '0.0.0.0/0',
    'disabled': 'false',
    'comment': ''
}]
```

**Change Password**:
```python
users = api.get_resource('/user')

for user in users.get():
    if user.get('name') == 'admin':
        new_password = generate_secure_password()
        users.set(
            numbers=user.get('.id'),
            password=new_password
        )
        print(f"Password rotated (store in vault)")
        break
```

**Python Wrapper**:
```python
async def rotate_admin_password(api_conn, new_password: str) -> bool:
    """Change admin user password."""
    users = api_conn.get_resource('/user')
    
    for user in users.get():
        if user.get('name') == 'admin':
            users.set(
                numbers=user.get('.id'),
                password=new_password
            )
            return True
    
    return False
```

---

### 5.4 Create Backup Admin User - `/user` (add)

**Purpose**: Create `backup-admin` user for emergency access (via WireGuard).

**Command**:
```python
users = api.get_resource('/user')
backup_password = generate_secure_password()

new_id = users.add(
    name='backup-admin',
    password=backup_password,
    group='full'
)
print(f"Backup user created with ID: {new_id}")

# Store backup_password in secure vault
```

**Python Wrapper**:
```python
async def create_backup_user(api_conn, backup_password: str) -> bool:
    """Create backup admin user for disaster recovery."""
    users = api_conn.get_resource('/user')
    
    # Check if already exists
    for user in users.get():
        if user.get('name') == 'backup-admin':
            return True  # Already exists
    
    users.add(
        name='backup-admin',
        password=backup_password,
        group='full'
    )
    return True
```

---

## 6. ROLLBACK (Error Recovery)

### 6.1 Remove WireGuard Configuration - `/interface/wireguard` (remove)

**Purpose**: Rollback if something fails (idempotent).

**Command**:
```python
wg = api.get_resource('/interface/wireguard')

for iface in wg.get():
    if iface['name'] == 'wg-mgmt':
        wg.remove(numbers=iface['.id'])
        print("WireGuard interface removed (cascades to peers, IPs)")
        break
```

**Python Wrapper**:
```python
async def rollback_wg_config(api_conn) -> bool:
    """Remove WireGuard interface and all related config."""
    try:
        wg = api_conn.get_resource('/interface/wireguard')
        
        for iface in wg.get():
            if iface['name'] == 'wg-mgmt':
                wg.remove(numbers=iface['.id'])
                return True
    except Exception as e:
        print(f"Rollback error: {e}")
    
    return False
```

---

## 7. PRODUCTION BEST PRACTICES

### 7.1 Connection Settings

```python
# PRODUCTION: Use encrypted connection
api = RouterOsApiPool(
    host=router_ip,
    username='admin',
    password=encrypted_password,  # From vault
    port=8729,                     # SSL/TLS
    plaintext_login=False,         # Enforce encryption
    timeout=10,                    # 10 second timeout
    use_ssl=True                   # Force SSL
)
```

### 7.2 Idempotency Pattern

```python
async def idempotent_operation(api_conn, check_func, add_func, unique_key):
    """
    Generic idempotent pattern.
    1. Check if already exists
    2. If yes, return
    3. If no, create
    """
    # Step 1: Check
    if check_func(api_conn, unique_key):
        return True  # Already done
    
    # Step 2: Create
    add_func(api_conn)
    
    # Step 3: Verify
    if check_func(api_conn, unique_key):
        return True
    
    raise OnboardingError("Idempotent operation failed")
```

### 7.3 Error Classification

```python
def classify_error(error: Exception) -> str:
    """Classify error as transient vs permanent."""
    
    error_str = str(error).lower()
    
    # Transient (retry)
    if any(x in error_str for x in ['timeout', 'connection', 'unavailable']):
        return 'TRANSIENT'
    
    # Permanent (don't retry)
    if any(x in error_str for x in ['credentials', 'permission', 'not found']):
        return 'PERMANENT'
    
    # Unknown (assume transient)
    return 'TRANSIENT'
```

### 7.4 Logging Template

```python
import logging

logger = logging.getLogger(__name__)

# Log all API calls
logger.info(f"[{router_id}] Calling /interface/wireguard")
logger.info(f"[{router_id}] WireGuard interface created: {interface_id}")
logger.debug(f"[{router_id}] Full response: {response}")
logger.error(f"[{router_id}] Failed to create interface: {error_msg}")
```

---

## 8. TESTING CHECKLIST

- [ ] Test each API endpoint in isolation
- [ ] Test idempotency (run 2x, should be same result)
- [ ] Test error handling (simulate API failures)
- [ ] Test credential rotation
- [ ] Test tunnel verification (wait for handshake)
- [ ] Test rollback (provision → error → rollback → retry)
- [ ] Test with actual RouterOS 7.x instance
- [ ] Test with VPN subnet conflicts
- [ ] Verify encryption on API port 8729
- [ ] Verify WireGuard key generation (never the same twice)

---

## 9. DEBUGGING COMMANDS

Run these directly on the router (via SSH) to debug:

```bash
# Check WireGuard interface status
/interface/wireguard/print

# Check WireGuard peers
/interface/wireguard/peers/print

# Monitor handshakes in real-time
/interface/wireguard/peers/stats print follow

# Show assigned IPs
/ip/address/print

# Check service bindings
/ip/service/print

# Verify API is listening
ss -tlnp | grep 8729

# Check WireGuard tunnel on Linux side
wg show

# Check route to router tunnel IP
ping 10.255.0.2
```

---

## 10. COMMON ERRORS & SOLUTIONS

| Error | Cause | Fix |
|---|---|---|
| `invalid key format` | Public key malformed | Verify key is base64, 44 chars |
| `endpoint required` | Peer missing endpoint IP | Add endpoint-address parameter |
| `address already exists` | IP already assigned | Idempotency check before adding |
| `no address found` | WireGuard IP not assigned | Run ensure_ip_address first |
| `connection timeout` | Router unreachable | Check credentials, network connectivity |
| `permission denied` | User not admin | Verify username/password |
| `tunnel not coming up` | Firewall blocking UDP 51820 | Check router firewall rules |
| `handshake never completed` | Peer not responding | Check endpoint reachability |

---

## Example: Complete Provisioning Call Sequence

```python
async def provision_example():
    # Setup
    api = RouterOsAPI("192.168.1.1", "admin", "password", port=8729)
    
    # Phase 1: Validate
    print("✓ Phase 1: Validating credentials")
    identity = await api.get_system_identity()
    
    # Phase 2: Create WireGuard
    print("✓ Phase 2: Creating WireGuard interface")
    iface_name, router_pubkey = await ensure_wg_interface(api)
    
    # Phase 3: Setup tunnel
    print("✓ Phase 3: Setting up tunnel")
    await ensure_wg_peer(api, "203.0.113.100", "backend_pubkey_here")
    await ensure_ip_address(api, "wg-mgmt", "10.255.0.2/32")
    await enable_wg_interface(api)
    
    # Phase 4: Verify
    print("✓ Phase 4: Verifying tunnel")
    is_up = await verify_tunnel_up(api)
    
    # Phase 5: Harden
    print("✓ Phase 5: Hardening router")
    await disable_insecure_services(api)
    new_pass = generate_secure_password()
    await rotate_admin_password(api, new_pass)
    
    print("✅ Provisioning complete!")
```

