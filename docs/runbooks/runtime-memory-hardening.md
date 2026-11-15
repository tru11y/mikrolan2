# Runbook — Durcissement mémoire et pool de connexions

Statut : **rien n'est appliqué sur le VPS par cette PR.** Le code ajoute des mesures et un backoff ; les réglages ci-dessous sont des propositions à appliquer séparément, avec autorisation explicite.

## Incident du 15/11/2026 (lecture seule)
- `/api/health` en timeout vers 09:55 UTC, processus `mikrolan-api` en état `D`, rétabli seul vers 10:05.
- Serveur de 913 Mo de RAM ; Node : ~345 Mo résidents et 670 à 820 Mo en swap (swap système 940 → 1075 Mo, pression I/O à 65 % sur 5 min).
- 27 erreurs Prisma `P2024` (pool de 3 connexions, attente de 10 s) entre 08:08 et 10:02, réparties sur tous les crons ; aucune avant.
- PostgreSQL sain (43 Mo, 4 connexions pour 100 autorisées, 0 verrou), Redis et files vides, disque à 39 %.
- Cause la plus probable : la mémoire de Node dépasse la RAM, d'où swap, I/O bloquée et pool Prisma de 3 connexions saturé. Aucun historique mémoire n'existait : c'est ce que les nouvelles mesures comblent.

## Ce que la PR apporte
1. **Backoff des routeurs au tunnel mort** (`router-sync-scheduler`) : après un échec, nouvelle tentative à 1 min, puis 5 min, 15 min, puis 1 h (au lieu de 25 s à 5 min plafonné). Le retour du handshake déclenche une lecture immédiate et remet le compteur à zéro. Les routeurs dont le tunnel n'est pas mort gardent le backoff normal (plafond 5 min). Les 2 routeurs injoignables consommaient en permanence environ 11 synchronisations de plus de 60 s par heure et occupaient le pool.
2. **`GET /admin/system-health` → `runtime`** :
   - `node` : `rssMb`, `heapUsedMb`, `heapTotalMb`, `externalMb`, `uptimeSeconds` ;
   - `system` (Linux) : `memTotalMb`, `memAvailableMb`, `swapTotalMb`, `swapUsedMb`, `swapUsedPercent`, `processSwapMb` ; `null` hors Linux ;
   - `prisma` (fenêtre glissante 1 h) : `queriesLast1h`, `avgQueryMsLast1h`, `maxQueryMsLast1h`, `slowQueriesLast1h` (≥ 2 s), `p2024Last1h`, `p2024Total`, `lastP2024At`. La durée d'une requête inclut l'attente d'une connexion du pool : c'est la mesure du temps d'attente.
   - `level` : ORANGE si swap > 50 % ou au moins 1 P2024 sur 1 h ; RED si swap > 80 % ou 10 P2024 ou plus sur 1 h. Ce sont des repères d'alerte, pas un diagnostic.
3. Aucune donnée sensible dans ces mesures. Les compteurs sont en mémoire : ils repartent de zéro au redémarrage (le swap système et le RSS viennent du noyau et sont toujours justes).

## Réglages proposés — NON appliqués
À décider après avoir lu `runtime` pendant 24 à 48 h (en particulier `heapUsedMb` et `processSwapMb`).

| Réglage | Valeur proposée | Où | Remarque |
|---|---|---|---|
| `NODE_OPTIONS` | `--max-old-space-size=512` (à ajuster après mesure) | `.env` du service | Si le tas réel dépasse la limite, Node s'arrête (OOM) et systemd le relance : bruyant mais bref, contre plusieurs minutes de swap. Ne pas descendre sous `heapUsedMb` mesuré + marge. |
| `MemoryHigh` / `MemoryMax` | `700M` / `850M` | drop-in systemd `mikrolan-api` | `MemoryHigh` provoque une récupération agressive dès qu'il est dépassé : si la charge réelle est plus grande, il aggrave le swap. À poser seulement avec `NODE_OPTIONS` ci-dessus, sinon préférer `MemoryMax` seul. Envisager `MemorySwapMax=0` pour qu'un dépassement échoue vite au lieu de paginer. |
| `Restart` | `on-failure` (déjà en place), `RestartSec=5` | unité systemd | inchangé |
| Pool Prisma | `connection_limit=10` (au lieu de 3) et `pool_timeout=20` | paramètres de `DATABASE_URL` | PostgreSQL autorise 100 connexions ; 4 utilisées. Un pool de 3 est le goulot quand les requêtes ralentissent. |
| RAM | 2 Go minimum | VPS | 913 Mo ne suffisent pas pour Node + PostgreSQL + Redis + Docker avec une marge. |

Drop-in systemd (exemple, à créer à la main sur le VPS) :
```ini
# /etc/systemd/system/mikrolan-api.service.d/memory.conf
[Service]
MemoryMax=850M
# MemoryHigh=700M   # seulement après mesure, voir le tableau
```

## Application (hors de cette PR)
1. Lire `runtime` plusieurs jours ; choisir `--max-old-space-size` d'après `heapUsedMb`.
2. Appliquer une valeur à la fois, hors pics, avec autorisation explicite (aucun déploiement manuel de code : seuls l'environnement et le drop-in changent).
3. Après redémarrage du service : vérifier `/api/health`, puis `runtime` (RSS, swap, `p2024Last1h`).
4. Retour arrière : supprimer le drop-in ou la variable, `systemctl daemon-reload`, redémarrer le service.

## Suites hors périmètre
Recherche de la croissance mémoire (profil de tas sur 24 h), délais d'attente par cron, métriques persistantes (`sysstat` ou exporteur) avec alerte sur le swap.
