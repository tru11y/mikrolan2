# MikroLan v2 — déploiement co-host VPS (139.84.241.27)

> **Garde-fous.** v1 est en prod sur ce VPS. Ne jamais toucher : `wg0`, nginx,
> les conteneurs v1, `.env.prod` v1. **Jamais `git pull`/`reset` sur le VPS**
> (fork divergente) → on `rsync`/`scp`. **Ne jamais builder le frontend/back sur
> le VPS** (2 Go → OOM) : build local, on n'envoie que `dist/`.

Archi **réellement déployée (2026-07-20)** : **API en conteneur `--network host
--cap-add NET_ADMIN`** (pilote `wg-mgmt` sur l'hôte, pas de Node à installer) ;
**Postgres + Redis en conteneurs `network_mode: host`** liés à `127.0.0.1`
(voir plus bas). Chemin `/opt/mikrolan-nest` (≠ `/opt/mikrolan` = rehost Python
**live**, ne pas toucher).

> **Piège ufw (résolu).** Ce VPS a `INPUT policy DROP` **sans** `-i lo -j ACCEPT`
> → tout le loopback est droppé. Sans la règle `iptables -I INPUT -i lo -j ACCEPT`
> (persistée en `PostUp` de `wg-mgmt.conf`), l'API host-network ne joint PAS
> Postgres/Redis (127.0.0.1) et les ports publiés bridge (docker-proxy) non plus.
> v1 n'en souffre pas (exposé via docker-proxy sur 0.0.0.0).

Build image local → `docker save | gzip > f && scp f && ssh 'gunzip -c f | docker load'`
(le pipe direct `save|ssh load` s'est fait reset ; passer par un fichier scp est fiable).

Migrate/seed/run (image chargée, `.env` prêt) :
```bash
cd /opt/mikrolan-nest
docker run --rm --network host --env-file .env mikrolan2-api:latest npx prisma migrate deploy
docker run --rm --network host --env-file .env -e SEED_SUPERADMIN_EMAIL=... \
  -e SEED_SUPERADMIN_PASSWORD=... mikrolan2-api:latest node dist/seed.js
docker run -d --name mikrolan2-api --network host --cap-add NET_ADMIN \
  --restart unless-stopped --env-file .env mikrolan2-api:latest
curl -s http://127.0.0.1:3002/api/health
```

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
Tourne en utilisateur dédié `mikrolan` + `CAP_NET_ADMIN` (pas root) — cap
juste ce qu'il faut pour `wg set wg-mgmt ...`.
```bash
useradd --system --no-create-home --shell /usr/sbin/nologin mikrolan
chown -R mikrolan:mikrolan /opt/mikrolan/backend
cp deploy/mikrolan-api.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mikrolan-api
curl -s http://127.0.0.1:3002/api/health   # {"success":true,...}
```
Si le service refuse de démarrer après ce changement (`journalctl -u mikrolan-api`),
c'est probablement une permission manquante sur un fichier lu/écrit par
l'app hors de `/opt/mikrolan/backend` — élargir `ReadWritePaths` dans
`mikrolan-api.service` plutôt que de repasser en root.

## 8. Exposition (transitoire, avant TLS)
Pas de nginx **v1** (interdit d'y toucher). Ouvrir le port haut directement :
```bash
iptables -A INPUT -p tcp --dport 3002 -j ACCEPT
```
Mobile → « Configurer le serveur » → `http://139.84.241.27:3002/api`.
⚠️ HTTP clair — remplacé par TLS à l'étape 9, à faire avant tout lancement public.

## 9. TLS — Caddy dédié v2 (`api.mikrolan.net:9443`, jamais le nginx v1)

> Le nginx v1 (conteneur `docker-nginx-1`, projet compose `docker`) occupe déjà
> **80 et 443** sur ce VPS via `docker-proxy` — vérifié (`ss -tlnp`). Caddy ne
> peut donc partager ni l'un ni l'autre sans toucher au nginx v1 (interdit). On
> utilise un défi **DNS-01** via Route 53 (domaine `mikrolan.net` sur AWS) pour
> éviter le port 80 lors de l'émission du certificat, et Caddy **sert** le
> trafic HTTPS sur le port **9443** (libre, vérifié via `ss -tlnp` — 9002-9254
> sont déjà réservés par un autre usage) plutôt que 443. Zéro contact avec le
> nginx v1.

Prérequis : DNS `A api.mikrolan.net → 139.84.241.27` déjà propagé et vérifié
(`nslookup api.mikrolan.net`, deux résolveurs indépendants).

Chemin réel sur le VPS : `/opt/mikrolan-nest/` (pas de sous-dossier `deploy/` —
`.env`, `.dbpass`, `docker-compose.prod.yml` à la racine ; `DATABASE_URL`,
`REDIS_HOST/PORT` déjà en place, `CORS_ORIGINS` vide à ce stade).

```bash
# 1. Build local de l'image Caddy custom (plugin route53 via xcaddy)
cd backend/deploy && docker build -f Dockerfile.caddy -t mikrolan2-caddy:latest .
docker save mikrolan2-caddy:latest | gzip > caddy.tar.gz
scp caddy.tar.gz Caddyfile caddy.env root@139.84.241.27:/opt/mikrolan-nest/
ssh root@139.84.241.27 'cd /opt/mikrolan-nest && gunzip -c caddy.tar.gz | docker load'

# 2. Ouvrir le port 9443 (443/80 restent au nginx v1, on n'y touche pas)
ssh root@139.84.241.27 'iptables -A INPUT -p tcp --dport 9443 -j ACCEPT'

# 3. Lancer Caddy (host network — atteint l'API sur 127.0.0.1:3002 directement)
ssh root@139.84.241.27 'docker run -d --name mikrolan2-caddy --network host \
  --env-file /opt/mikrolan-nest/caddy.env \
  -v /opt/mikrolan-nest/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v caddy_data:/data \
  --restart unless-stopped mikrolan2-caddy:latest'

# 4. Vérifier le certificat + la route
curl -I https://api.mikrolan.net:9443/api/health

# 5. Une fois HTTPS confirmé stable : fermer le port 3002 en public
#    (Caddy → API reste possible via loopback, déjà autorisé par la règle
#    `-i lo -j ACCEPT` du piège ufw documenté en tête de fichier)
ssh root@139.84.241.27 'iptables -D INPUT -p tcp --dport 3002 -j ACCEPT'
```

`.env` API : ajouter `CORS_ORIGINS=https://api.mikrolan.net:9443` (et toute
autre origine web future) avant redémarrage du conteneur `mikrolan2-api`.

Mobile → « Configurer le serveur » → `https://api.mikrolan.net:9443/api`.

## Rollback complet
```bash
systemctl disable --now mikrolan-api wg-quick@wg-mgmt
docker rm -f mikrolan2-caddy
docker compose -f /opt/mikrolan/backend/deploy/docker-compose.prod.yml down
iptables -D INPUT -p udp --dport 51822 -j ACCEPT
iptables -D INPUT -p tcp --dport 3002 -j ACCEPT
rm -rf /opt/mikrolan
```
