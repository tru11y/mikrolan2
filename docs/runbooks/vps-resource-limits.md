# VPS resource limits — systemd + Postgres

Durcit le VPS contre les saturations RAM/CPU. À lire avec [`vps-capacity.md`](./vps-capacity.md) (capacités constatées) et [`runtime-memory-hardening.md`](./runtime-memory-hardening.md) (mesures côté Node/Prisma).

Unit systemd : [`backend/deploy/systemd/mikrolan-api.service`](../../backend/deploy/systemd/mikrolan-api.service).
Installation : `sudo backend/deploy/systemd/install.sh` (idempotent — daemon-reload + enable au boot).

---

## Directives systemd (pourquoi)

| Directive | Rôle |
|---|---|
| `MemoryMax=720M` | Plafond dur. Au-dessus, le kernel OOM-kille le process. Dernier rempart. |
| `MemoryHigh=600M` | Seuil mou. Au-dessus, systemd throttle (reclaim) sans tuer. Zone de confort visée. |
| `CPUQuota=180%` | 1,8 vCPU max. Laisse Postgres + nginx respirer même sous burst. |
| `TasksMax=512` | Garde-fou contre fork-bomb / fuite de threads (BullMQ workers, Prisma engines). |
| `OOMScoreAdjust=-100` | Rend l'API moins candidate à l'OOM-killer kernel que Postgres / sshd. |
| `OOMPolicy=stop` | Si OOM, systemd arrête proprement (plutôt que de laisser le kernel tuer un enfant random). `Restart=on-failure` reprend derrière. |
| `Restart=on-failure` + `RestartSec=5s` | Reprise automatique après crash, 5s de backoff. |
| `StartLimitBurst=5` / `StartLimitIntervalSec=120` | Au-delà de 5 redémarrages en 2 min → arrêt (crashloop → alerte). |
| `--max-old-space-size=512` (Node) | Plafonne le heap V8 en dessous de `MemoryHigh` pour que la GC agisse avant systemd. |
| `NoNewPrivileges=true` | Empêche l'escalade via setuid. |
| `PrivateTmp=true` | /tmp isolé par unit. |
| `ProtectSystem=strict` + `ReadWritePaths=` | FS en lecture seule hors `/opt/mikrolan2`, `/opt/mikrolan2-releases`, `/var/log/mikrolan`. |
| `ProtectHome=true` | /home inaccessible au service. |

---

## Paliers recommandés par taille de VPS

Les valeurs ci-dessous sont des points de départ ; valider avec `post_restart_rss_check` (log `[deploy]`) sur 48 h et ajuster.

### VPS 1 Go RAM (dev / staging étroit)

Déconseillé en prod. Postgres et l'API cohabitent à peine ; aucune marge pour BullMQ.

Drop-in `/etc/systemd/system/mikrolan-api.service.d/override.conf` :

```ini
[Service]
MemoryMax=380M
MemoryHigh=320M
CPUQuota=100%
Environment=NODE_OPTIONS=--max-old-space-size=256
```

Postgres (`/etc/postgresql/*/main/postgresql.conf`) :

- `shared_buffers = 128MB`
- `work_mem = 2MB`
- `maintenance_work_mem = 32MB`
- `max_connections = 25`
- `effective_cache_size = 400MB`

### VPS 2 Go RAM (prod actuelle MikroLan) — valeur par défaut de l'unit

- API : `MemoryMax=720M` / `MemoryHigh=600M` / `CPUQuota=180%` / Node `--max-old-space-size=512`.
- Laisse ~1,2 Go pour Postgres + système + nginx + marge OOM.

Postgres :

- `shared_buffers = 512MB`
- `work_mem = 8MB`
- `maintenance_work_mem = 128MB`
- `max_connections = 50`
- `effective_cache_size = 1200MB`

### VPS 4 Go RAM (croissance)

Drop-in :

```ini
[Service]
MemoryMax=1536M
MemoryHigh=1280M
CPUQuota=300%
TasksMax=1024
Environment=NODE_OPTIONS=--max-old-space-size=1024
```

Postgres :

- `shared_buffers = 1GB`
- `work_mem = 16MB`
- `maintenance_work_mem = 256MB`
- `max_connections = 100`
- `effective_cache_size = 2560MB`

> Rappel : `work_mem` est **par opération de tri** dans **chaque** connexion. Le pire cas RAM Postgres ≈ `shared_buffers + max_connections × work_mem × N(tris/connexion)`. Ne pas gonfler `work_mem` sans baisser `max_connections`.

---

## Procédure de bump des limites

À appliquer quand `post_restart_rss_check` trace un WARN persistant (> 80 % de `MemoryHigh` pendant plusieurs déploiements) ou que `journalctl -u mikrolan-api | grep -i oom` remonte un évènement.

1. Confirmer la pression : `systemctl show mikrolan-api -p MemoryCurrent -p MemoryHigh -p MemoryMax -p CPUUsageNSec`.
2. Vérifier la marge VPS : `free -m` (MemAvailable > nouvelle `MemoryMax` + 300 Mo), `df -h /` (> 1,5 Go libres), `swapon --show`.
3. Éditer **un drop-in**, jamais l'unit versionnée :
   ```sh
   sudo systemctl edit mikrolan-api
   ```
   Ajouter uniquement les clés modifiées sous `[Service]` (voir paliers ci-dessus).
4. `sudo systemctl daemon-reload && sudo systemctl restart mikrolan-api`.
5. `systemctl status mikrolan-api` → actif + nouvelles limites visibles dans `systemctl show`.
6. Healthcheck : `curl -fsS http://127.0.0.1:3002/api/health`.
7. Journaliser dans `docs/runbooks/vps-capacity.md` (valeurs + date + motif) et rouvrir un déploiement nominal pour relire `post_restart_rss_check`.

**Rollback bump** : `sudo systemctl revert mikrolan-api` supprime le drop-in, puis `daemon-reload` + `restart`.

---

## Diagnostic rapide

| Symptôme | Commande |
|---|---|
| Service OOM-killed | `journalctl -u mikrolan-api -n 200 \| grep -Ei 'oom\|killed\|memory'` |
| RSS actuel vs limites | `systemctl show mikrolan-api -p MemoryCurrent -p MemoryHigh -p MemoryMax` |
| CPU cumulé | `systemctl show mikrolan-api -p CPUUsageNSec` |
| Crashloop (StartLimit) | `systemctl status mikrolan-api` → `start-limit-hit` |
| Postgres mange tout | `ps -o pid,rss,cmd -C postgres --sort=-rss \| head` |

Voir aussi [`deploy-interrupted.md`](./deploy-interrupted.md) pour les récupérations après restart raté.
