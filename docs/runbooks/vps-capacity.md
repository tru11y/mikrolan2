# Capacité du VPS (mémoire) et seuils de déploiement

## Mesures du 15/11/2026 (lecture seule)
| Élément | Valeur |
|---|---|
| RAM totale | 913 Mo |
| CPU | 2 |
| Swap | 2 047 Mo (≈ 1 Go déjà utilisé au repos après l'incident) |
| API NestJS (`dist/main.js`) | ≈ 152 Mo résidents |
| PostgreSQL, Redis, Docker (cumul) | ≈ 204 Mo |
| Mémoire disponible au repos | ≈ 320 Mo |
| Disque | 39 Go dont 24 Go libres |
| Node / npm sur le serveur | 20.20.2 / 10.8.2 (la CI utilise Node 22) |

Marge réelle : **≈ 300 Mo** pour tout ce qui n'est pas la production.

## Pourquoi l'ancien déploiement ne tient pas
| Étape (sur le VPS) | Besoin mémoire | Remarque |
|---|---|---|
| `npm ci --legacy-peer-deps` (≈ 560 paquets, dev compris) | plusieurs centaines de Mo en pointe, I/O intense | provoque le swap et ralentit l'API |
| `nest build` / `tsc` | 1 Go autorisé (`--max-old-space-size=1024`) | dépasse la RAM physique |
| `node_modules` vidé puis recréé pendant que l'API tourne | — | un échec laisse une installation incomplète |

Le 15/11/2026 : `npm ci` > 15 min, swap 1,4 Go, charge 12, API injoignable, job expiré (10 min).

## Seuils appliqués par `deploy-release.sh` (modifiables par variables d'environnement)
| Variable | Défaut | Rôle |
|---|---|---|
| `MIN_AVAIL_MB` | 300 | mémoire disponible minimale avant de commencer |
| `MAX_SWAP_USED_MB` | 1700 | swap utilisé maximal avant de commencer |
| `MIN_DISK_MB` | 1500 | espace disque libre minimal |
| `HEALTH_TIMEOUT_S` | 90 | délai pour que la nouvelle version réponde avant retour arrière |
| `KEEP_RELEASES` | 3 | versions conservées |

Au-delà de ces seuils, le déploiement **s'arrête sans rien modifier**.

## Recommandations d'infrastructure (décision du propriétaire, hors de ce dépôt)
1. **RAM 2 Go minimum, 4 Go recommandé** : marge pour l'API, PostgreSQL, Redis, WireGuard et un déploiement sans swap.
2. **Swap 4 Go** (sur disque rapide) et `vm.swappiness` bas (10 à 20) pour que l'API ne soit pas swappée en priorité.
3. Surveiller : mémoire disponible, swap utilisé, charge, `/api/health` ; alerter au-dessus de 1 Go de swap utilisé.
4. Le déploiement par artefact supprime la pression de `npm ci` et du build ; la RAM reste utile pour la croissance (BullMQ, rapports, SasPay).

Exemples de commandes (à adapter, à exécuter par le propriétaire, hors déploiement) :
```bash
sudo fallocate -l 4G /swapfile2 && sudo chmod 600 /swapfile2 && sudo mkswap /swapfile2 && sudo swapon /swapfile2
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf && sudo sysctl --system
```

## Après activation du déploiement par artefact
Mesurer sur 3 déploiements : mémoire disponible minimale pendant l'extraction (tar) et la migration, durée totale, taille de l'archive. Réajuster les seuils.
