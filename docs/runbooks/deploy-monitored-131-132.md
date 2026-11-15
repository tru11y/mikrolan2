# Déploiement monitoré de #131 et #132 — état réel et procédure

Audit lecture seule du 15/11/2026 ~11:10 UTC. Rien n'a été modifié sur le VPS.

## Verdict : le prochain redémarrage N'EST PAS sûr
| Constat | Valeur |
|---|---|
| Code sur disque (`git HEAD`) | `10c7f3a` (#132) ; #131 et #132 **non compilés** |
| `dist/main.js` | 14/11 00:09 (avant #131) |
| Service | actif depuis le 14/11 00:10, `NRestarts=0`, process `dist/main.js` en état **D**, RSS ≈ 20 Mo (presque tout en swap) |
| `/api/health` | **timeout (000)** à 10 s, deux mesures consécutives |
| Charge / mémoire | load 9–11 ; disponible 134–505 Mo ; swap 1,15–1,3 Go / 2 Go |
| `node_modules` | 560 entrées mais **`argon2`, `@prisma/client`, `.prisma/client` absents**, `.package-lock.json` absent |
| CI `main` | deux déploiements en échec : #131 (10:07) et #132 (10:52). Le 2ᵉ `npm ci` a de nouveau vidé `node_modules` (mtime 11:04) |

Conséquences :
1. L'API actuelle tient grâce aux modules déjà chargés en mémoire. **Tout redémarrage (systemd, OOM-kill, reboot) échoue** : `Cannot find module 'argon2'` / `@prisma/client`.
2. Un nouveau `git push` sur `main` relance le même déploiement et le même `npm ci` sur 913 Mo : même échec probable, et nouvelle dégradation de l'API.
3. L'API est déjà dégradée (health en timeout) : ne rien lancer de lourd dessus.

## Cause (pipeline)
`ci.yml` job `deploy` : `sudo npm ci --legacy-peer-deps` (dev comprises, ≈ 560 paquets) + `nest build` (1 Go autorisé) sur 913 Mo, dans le répertoire live, sans contrôle de mémoire, sans verrou, délai SSH 10 min. Un échec laisse `node_modules` vide. Correctif : PR #133 (artefact + garde-fous), non activée.

## Procédure recommandée (décisions humaines à chaque étape)
**0. Geler** : aucun push sur `main`, #127 et #130 non fusionnées. Surveiller (lecture seule) :
`cut -d' ' -f1-3 /proc/loadavg; free -m; curl -m 10 -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/api/health`

**1. Stabiliser sans redémarrer** : attendre que le swap retombe ; vérifier qu'aucun `npm` ne tourne (`pgrep -a npm`). Ne pas tuer le process API (D = I/O swap en cours).

**2. Sauvegarde fraîche** (obligatoire avant tout changement) : `backend/deploy/backup/pg_backup.sh`, vérifier le fichier et sa taille ; copier `private-uploads/` et `uploads/`.

**3. Remettre le VPS dans un état redémarrable** — fenêtre calme, API acceptée indisponible quelques minutes si besoin :
- Option A (rapide, sans artefact) : arrêter l'API, `npm ci --omit=dev --legacy-peer-deps && npx prisma generate` dans `/opt/mikrolan2/backend` (sans dev, sans build : moins de RAM), puis compiler **ailleurs** et copier `dist/`.
- Option B (recommandée) : activer #133 (artefact construit en CI) après relecture : `deploy-artifact.md`. Le VPS n'exécute plus npm.
Dans les deux cas : prérequis RAM (idéalement augmenter à 2 Go : `vps-capacity.md`).

**4. Déployer #131 + #132** (même artefact, `10c7f3a`) : migrations ? #131 et #132 n'en ajoutent pas (à revérifier : `git diff 3366a41~1..10c7f3a --stat -- backend/prisma`). Contrôler pendant le déploiement : mémoire disponible, swap, health, `deploys.log`.

**5. Vérifier** : `GET /admin/system-health` → blocs `authSessions` (#131) et `runtime` (#132) présents ; RSS, swap, P2024 (1 h) ; aucun niveau RED.

**6. Observer 24–48 h** : relever chaque heure RSS, swap, P2024, durée moyenne/max des requêtes, `replayDelayMs` des refresh. Décider ensuite de #127 puis de la grâce-session (#131).

## Critères d'arrêt / retour arrière
- Health ≠ 200 pendant > 90 s après bascule → retour arrière (`rollback.sh`, ou ancien `dist`).
- Swap > 1,7 Go ou disponible < 300 Mo avant de commencer → ne pas démarrer.
- `Cannot find module` au démarrage → `node_modules` incomplet : étape 3.
