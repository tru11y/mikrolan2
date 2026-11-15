# Reprise après un déploiement interrompu

Ce document décrit **quoi observer et quoi décider**. Les commandes d'écriture sont à exécuter **par un humain**, après lecture de l'état ; aucune n'est lancée automatiquement.

## 1. Reconnaître l'incident
- Le job « Deploy to VPS » échoue avec `Run Command Timeout` (délai de 10 min de l'action SSH) pendant `npm ci`.
- `/api/health` ne répond pas ou très lentement, alors que `systemctl is-active mikrolan-api` dit `active`.
- Charge élevée, swap > 1 Go, un processus `npm ci` encore vivant sur le VPS.

## 2. Observer (lecture seule, sans rien arrêter)
```bash
cut -d" " -f1-3 /proc/loadavg; free -m                       # charge, mémoire, swap
ps -eo pid,etime,pcpu,pmem,args --sort=-pcpu | head          # qui consomme (npm ci ?)
curl -s -m 8 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/api/health
systemctl show mikrolan-api -p ActiveEnterTimestamp -p NRestarts
git -C /opt/mikrolan2 rev-parse --short HEAD                  # code arrivé sur le disque
stat -c %y /opt/mikrolan2/backend/dist/main.js                # version réellement compilée
ls /opt/mikrolan2/backend/node_modules/.package-lock.json    # absent = installation interrompue
```

## 3. Décider
| Situation | Décision |
|---|---|
| `npm ci` tourne encore, l'API est lente | **Attendre** (10 à 15 min). Ne pas le tuer : il vide `node_modules` avant de réinstaller, l'interrompre laisse une installation incomplète. |
| `npm ci` terminé, API 200 | Production stable. Risque restant : **un redémarrage échouerait** si `node_modules` est incomplet (fichier `.package-lock.json` absent). Ne pas redémarrer le service entre-temps. |
| L'API reste injoignable après 15 min | Décision humaine : (a) laisser finir `npm ci`, ou (b) l'arrêter puis relancer le déploiement par la CI. Prévenir qu'un arrêt du `npm ci` laisse `node_modules` à reconstruire. |
| Service tombé et `node_modules` incomplet | Reconstruire d'abord les dépendances (`npm ci --omit=dev --legacy-peer-deps` dans `/opt/mikrolan2/backend`, en dehors d'un déploiement, VPS au calme) puis redémarrer. |

## 4. Revenir à un état sain
1. **Ancien mode (actuel)** : quand la production est stable et qu'une fenêtre calme est choisie, relancer le job « Deploy to VPS » du dernier commit (re-run). Il refait `npm ci`, build et redémarrage. Surveiller mémoire et swap pendant l'opération.
2. **Mode artefact** : voir `deploy-artifact.md`. L'arborescence en service n'est jamais touchée par un déploiement ; un déploiement interrompu laisse au pire un dossier `.staging-<sha>` ou une version non activée.

## 5. Après un déploiement par artefact interrompu
- `readlink -f /opt/mikrolan2-releases/current` : doit pointer sur une version complète (contient `dist/main.js`). C'est le cas tant que la bascule n'a pas eu lieu.
- `/opt/mikrolan2-releases/deploys.log` : dernière ligne (`OK`, `ROLLED_BACK`, `ROLLBACK_FAILED`).
- Dossiers `.staging-*` : orphelins, supprimables après vérification qu'aucun `deploy-release.sh` ne tourne (`pgrep -f deploy-release`).
- `ROLLBACK_FAILED` : ni la nouvelle ni l'ancienne version ne répondent. Voir `journalctl -u mikrolan-api -n 100`, remettre la dernière version saine avec `rollback.sh <sha>`, ou l'ancien répertoire avec `rollback.sh /opt/mikrolan2/backend`.

## 6. À consigner
Heure, commit déployé, état mémoire/swap, décision et auteur, dans le journal d'exploitation.
