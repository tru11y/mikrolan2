# MikroLan v2 — déploiement co-host VPS (139.84.241.27)

> **Garde-fous.** v1 est en prod sur ce VPS. Ne jamais toucher : `wg0`, nginx,
> les conteneurs v1, `.env.prod` v1. **Jamais `git pull`/`reset` sur le VPS**
> (fork divergente) → on `rsync`/`scp`. **Ne jamais builder le frontend/back sur
> le VPS** (2 Go → OOM) : build local, on n'envoie que `dist/`.

Archi retenue : **API bare-metal (systemd)** sur l'hôte (pour piloter `wg-mgmt`
sans nsenter) ; **Postgres + Redis en Docker** isolés de v1.

Ports/réseau dédiés (disjoints de v1) : API `3002`, PG `127.0.0.1:5544`,
Redis `127.0.0.1:6390`, WG `51822/udp`, subnet `10.20.0.0/24`.

## 1. Build local (jamais sur le VPS)
```bash
cd backend && npm ci && npm run build   # produit dist/
```

## 2. Envoi du code (rsync, pas git)
```bash
rsync -az --delete dist/ package.json package-lock.json prisma/ \
  deploy/ root@139.84.241.27:/opt/mikrolan/backend/
```

## 3. Postgres + Redis (Docker, isolés)
```bash
cd /opt/mikrolan/backend/deploy
DB_PASSWORD=<fort> docker compose -f docker-compose.prod.yml up -d
```

## 4. Tunnel WireGuard `wg-mgmt`
```bash
wg genkey | tee /etc/wireguard/wg-mgmt.key | wg pubkey > /etc/wireguard/wg-mgmt.pub
# créer /etc/wireguard/wg-mgmt.conf depuis wg-mgmt.conf.example (PrivateKey = contenu de wg-mgmt.key)
systemctl enable --now wg-quick@wg-mgmt
iptables -A INPUT -p udp --dport 51822 -j ACCEPT   # PAS via nginx
```

## 5. .env API (`/opt/mikrolan/backend/.env`)
```
NODE_ENV=production
PORT=3002
DATABASE_URL=postgresql://mikrolan:<DB_PASSWORD>@127.0.0.1:5544/mikrolan?schema=public
REDIS_HOST=127.0.0.1
REDIS_PORT=6390
JWT_ACCESS_SECRET=<openssl rand -hex 24>
JWT_REFRESH_SECRET=<openssl rand -hex 24>
ROUTER_CRED_KEY=<openssl rand -hex 32>
CORS_ORIGINS=
WG_ENABLED=true
WG_INTERFACE=wg-mgmt
WG_SERVER_PUBLIC_KEY=<contenu de wg-mgmt.pub>
WG_ENDPOINT=139.84.241.27:51822
WG_SUBNET_BASE=10.20.0.0/24
WG_PORT_MIN=41000
WG_PORT_MAX=41999
SEED_SUPERADMIN_EMAIL=<toi>
SEED_SUPERADMIN_PASSWORD=<fort>
```

## 6. Dépendances + migrations + seed (sur le VPS)
```bash
cd /opt/mikrolan/backend
npm ci                      # inclut prisma CLI (node_modules OK sur 2 Go)
npx prisma migrate deploy
npx prisma generate
npx ts-node prisma/seed.ts  # crée le SUPER_ADMIN (ou node avec un seed compilé)
```

## 7. Service systemd
```bash
cp deploy/mikrolan-api.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mikrolan-api
curl -s http://127.0.0.1:3002/api/health   # {"success":true,...}
```

## 8. Exposition
Pas de nginx (interdit). Ouvrir le port haut directement :
```bash
iptables -A INPUT -p tcp --dport 3002 -j ACCEPT
```
Mobile → « Configurer le serveur » → `http://139.84.241.27:3002/api`.
⚠️ HTTP clair : pour la prod publique, prévoir un domaine + TLS (Let's Encrypt).

## Rollback complet
```bash
systemctl disable --now mikrolan-api wg-quick@wg-mgmt
docker compose -f /opt/mikrolan/backend/deploy/docker-compose.prod.yml down
iptables -D INPUT -p udp --dport 51822 -j ACCEPT
iptables -D INPUT -p tcp --dport 3002 -j ACCEPT
rm -rf /opt/mikrolan
```
