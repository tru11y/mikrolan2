# Déploiement de la console web (Next.js) — `console.mikrolan.net`

**Statut : prêt dans le dépôt, NON activé.** La console web est construite et livrée par le même pipeline
par artefact que l'API (`DEPLOY_MODE=artifact`). Tant que `mikrolan-web.service` n'est pas installée et
activée à la main sur le VPS, rien ne change : `deploy-release.sh` ne redémarre la console que si l'unit
existe et que l'archive contient `web/`.

## Architecture (calquée sur l'API)
```
GitHub Actions (Node 20)                     VPS (host, pas de conteneur)
────────────────────────                     ────────────────────────────────────────────
build-release.sh :                           /opt/mikrolan2-releases/<sha>/web/   ← console (build autonome)
  backend → dist/, prisma/, node_modules      /opt/mikrolan2-releases/current      → version en service (lien)
  web/   → next build (output standalone)
           → <archive>/web/ (server.js +      mikrolan-api.service   → node dist/main.js        (127.0.0.1:3002)
             node_modules élagué + static)    mikrolan-web.service   → node web/server.js        (127.0.0.1:3100)
archive + sha256 ──scp──▶ deploy-release.sh : bascule « current » → restart mikrolan-api → restart mikrolan-web

Caddy (host, systemd) :
  api.mikrolan.net     → reverse_proxy 127.0.0.1:3002
  console.mikrolan.net → reverse_proxy 127.0.0.1:3100
```

## Choix : build autonome (`output: 'standalone'`)
`web/next.config.mjs` fixe `output: 'standalone'`. `next build` produit `.next/standalone/server.js` avec
un `node_modules` élagué. L'artefact n'embarque donc **que** le standalone (pas tout `node_modules`), plus
les assets statiques :

| Source (CI)              | Destination dans l'archive        |
|--------------------------|-----------------------------------|
| `web/.next/standalone/.` | `web/` (dont `server.js`)          |
| `web/.next/static`       | `web/.next/static`                 |
| `web/public` (si présent)| `web/public`                       |

`mikrolan-web.service` lance `node server.js` avec `WorkingDirectory=…/current/web`, `PORT=3100`,
`HOSTNAME=127.0.0.1`. (Le serveur autonome ignore `next start -p` : le port vient de `PORT`.)

## `NEXT_PUBLIC_API_BASE_URL` est FIGÉE au build
Cette variable est **inlinée dans le bundle client** au `next build`. `build-release.sh` la fixe à
`https://api.mikrolan.net` (surchargeable via l'environnement pour un build de test). **Changer l'URL de
l'API impose de reconstruire** l'artefact ; modifier l'environnement systemd ne suffit pas.

## Prérequis DNS (avant activation)
Enregistrement **A `console.mikrolan.net` → IP du VPS** dans route53 (même zone que `api.mikrolan.net`,
déjà gérée par Caddy via `dns route53` pour l'émission du certificat TLS).

## Activation (première fois, manuelle, en root, sur le VPS, en fenêtre calme)
Prérequis : le déploiement par artefact de l'API est déjà actif (`DEPLOY_MODE=artifact`), donc
`/opt/mikrolan2-releases/current/web/` existe après un déploiement.

1. **Installer l'unit** :
   ```bash
   sudo install -m 644 backend/deploy/release/mikrolan-web.service /etc/systemd/system/mikrolan-web.service
   sudo systemctl daemon-reload
   ```
2. **Démarrer + activer au boot** :
   ```bash
   sudo systemctl enable --now mikrolan-web
   sudo systemctl status mikrolan-web
   curl -fsS http://127.0.0.1:3100/ >/dev/null && echo "console OK"
   ```
3. **DNS** : vérifier que `console.mikrolan.net` résout vers l'IP du VPS (voir ci-dessus).
4. **Caddy** : insérer le bloc de `backend/deploy/caddy/console.caddy` dans
   `/opt/mikrolan-nest/Caddyfile` (à côté du bloc `api.mikrolan.net`), puis :
   ```bash
   sudo systemctl reload caddy
   ```
5. **Vérifier** : `https://console.mikrolan.net` répond (TLS émis par Caddy), la console appelle bien
   `https://api.mikrolan.net`.

## Déploiements suivants (automatiques)
Chaque push sur `main` (mode artefact) reconstruit backend + web, livre l'archive, bascule `current` et
`deploy-release.sh` redémarre `mikrolan-api` **puis** `mikrolan-web` (au mieux). Aucune action manuelle.

## Point d'attention — RAM
Le VPS a ~913 Mo. `mikrolan-api` a `MemoryMax=720M` ; `mikrolan-web` est plafonnée à `MemoryMax=300M`.
Surveiller `free -m` et `systemctl status mikrolan-web` après activation ; ajuster les plafonds via un
drop-in `/etc/systemd/system/mikrolan-web.service.d/` si nécessaire (cf. `vps-resource-limits.md`).

## Désactivation / retour arrière
- Console seule : `sudo systemctl disable --now mikrolan-web`, retirer le bloc Caddy, `reload caddy`.
  L'API n'est pas affectée.
- Un retour arrière de version (`rollback.sh`) rebascule `current` : la console suit (redémarrage au mieux
  de `mikrolan-web` par le script de déploiement au prochain déploiement ; sinon `systemctl restart mikrolan-web`).
