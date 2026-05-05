from routeros_api import RouterOsApiPool

api_pool = RouterOsApiPool(
    host="10.10.10.1",
    username="admin",
    password="F!r3stone@",
    port=8728,      # LAN uniquement
    plaintext_login=True
)

api = api_pool.get_api()
identity = api.get_resource('/system/identity').get()
print(identity)
wg = api.get_resource('/interface/wireguard')

interfaces = wg.get()

wg_iface = None
for iface in interfaces:
    if iface['name'] == 'wg-mgmt':
        wg_iface = iface
        break

if wg_iface is None:
    wg.add(
        name='wg-mgmt',
        listen_port='51820',
        mtu='1420'
    )
    print("✅ Interface WireGuard créée")
else:
    print("ℹ️ Interface WireGuard déjà existante")

# Lire la clé publique
interfaces = wg.get()
for iface in interfaces:
    if iface['name'] == 'wg-mgmt':
        router_pubkey = iface['public-key']
        print("✅ WireGuard public key :", router_pubkey)

peers = api.get_resource('/interface/wireguard/peers')

# Vérifier si le peer backend existe déjà
existing_peers = peers.get()
peer_exists = False
for p in existing_peers:
    if p.get('interface') == 'wg-mgmt' and p.get('endpoint-address') == 'BACKEND_IP':
        peer_exists = True
        break
BACKEND_PUBLIC_KEY = '1XQ53CfYH/AyDdWpTZXK0dVMdda9dqPcA3Gh1F8D4Bo='

if not peer_exists:

    peers.add(
        interface='wg-mgmt',
        public_key=BACKEND_PUBLIC_KEY.strip(),   # ← colle ici la clé publique backend
        endpoint_address='BACKEND_IP',     # ← IP publique du backend
        endpoint_port='51820',
        allowed_address='10.255.0.1/32',
        persistent_keepalive='25'
    )
    print("✅ Peer backend ajouté côté routeur")
else:
    print("ℹ️ Peer backend déjà existant")


ip_addr = api.get_resource('/ip/address')

addresses = ip_addr.get()
has_ip = any(a['interface'] == 'wg-mgmt' for a in addresses)

if not has_ip:
    ip_addr.add(
        address='10.255.0.2/32',
        interface='wg-mgmt'
    )
    print("✅ IP WireGuard ajoutée au routeur")
else:
    print("ℹ️ IP WireGuard déjà présente")