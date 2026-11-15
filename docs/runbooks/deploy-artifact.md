# Déploiement par artefact (sans `npm ci` sur le VPS)

**Statut : prêt dans le dépôt, NON activé.** Tant que la variable GitHub `DEPLOY_MODE` n'est pas `artifact`, le déploiement historique (`npm ci` + build sur le VPS) reste le seul actif : fusionner ce changement ne modifie rien en production.

## Pourquoi
Le VPS n'a que 913 Mo de RAM. L'ancien déploiement y installait toutes les dépendances (dev comprises), y compilait, et vidait `node_modules` pendant que l'API tournait. Le 15/11/2026, `npm ci` a saturé la mémoire (swap 1,4 Go, charge 12), l'API a cessé de répondre et le job a expiré en laissant une installation incomplète. Voir `deploy-interrupted.md` et `vps-capacity.md`.

## Principe
```
GitHub Actions (Node 20, ubuntu-22.04)              VPS
──────────────────────────────────────              ──────────────────────────────────────────────
build + dépendances de PRODUCTION seulement         /opt/mikrolan2/backend            ← données, .env, ancien code (jamais supprimé)
archive + somme de contrôle + manifeste  ──scp──▶   /opt/mikrolan2-releases/<sha>/    ← versions immuables
                                                    /opt/mikrolan2-releases/current   → version en service (lien)
                                      deploy-release.sh : verrou → ressources → extraction → modules natifs
                                      → [sauvegarde + migration] → bascule atomique → redémarrage → santé
                                      → retour arrière automatique si la santé échoue → nettoyage
```
- Le VPS **n'exécute plus `npm`** ni `tsc` : rien à compiler, rien à installer.
- L'arborescence qui tourne n'est **jamais modifiée** : la nouvelle version est préparée à côté.
- Données et configuration restent dans `/opt/mikrolan2/backend` (`private-uploads/`, `uploads/`, `.env`) et sont **liées** (jamais copiées) dans chaque version.

## Protections (testées dans `backend/deploy/release/test/run-tests.sh`)
| Protection | Effet |
|---|---|
| Verrou (`flock`) | un seul déploiement ou retour arrière à la fois |
| Mémoire disponible < 300 Mo, swap utilisé > 1,7 Go, disque < 1,5 Go | **abandon avant toute modification** |
| Somme de contrôle SHA-256 | archive corrompue refusée |
| Version majeure de Node du manifeste ≠ serveur | refusé |
| Modules natifs (`argon2`, moteur Prisma) chargés sur ce serveur | refusé avant migration et bascule |
| Nouvelle migration | `pg_backup.sh` obligatoire ; échec de sauvegarde ou de migration = rien n'est activé |
| Santé `/api/health` après redémarrage (90 s) | sinon **retour arrière automatique** vers la version précédente |
| Signal HUP ignoré | une session SSH qui tombe n'interrompt pas la bascule |
| Dossier temporaire, extraction `.staging-*` | nettoyés à la sortie |
| Conservation | 3 versions ; la version en service et la précédente ne sont jamais supprimées |
| `VPS_KNOWN_HOSTS` obligatoire, `StrictHostKeyChecking=yes` | empreinte du serveur épinglée |
| `environment: production`, `concurrency`, délais | approbation possible, pas de déploiements parallèles |

**Limite à connaître :** une migration déjà appliquée n'est pas annulée par un retour arrière. Les migrations doivent rester **compatibles avec la version précédente du code** (colonnes ajoutées nullables, pas de suppression avant un déploiement intermédiaire).

## Données persistantes
Audit du code (`process.cwd()` + écritures disque) : l'API n'écrit que dans deux répertoires relatifs au répertoire de travail. `deploy-release.sh` les **lie** dans chaque version vers `DATA_ROOT` (`/opt/mikrolan2/backend`) ; ils ne vivent jamais dans `releases/<sha>`, ne sont jamais copiés ni supprimés par le nettoyage.

| Répertoire (lien dans `<sha>/`) | Cible permanente | Contenu | Conservé au déploiement | Conservé au rollback |
|---|---|---|---|---|
| `private-uploads/proofs` | `/opt/mikrolan2/backend/private-uploads/proofs` | preuves de paiement (SasPay, Wave/Orange) | oui | oui |
| `private-uploads/ticket-vault/<tenantId>` | `/opt/mikrolan2/backend/private-uploads/ticket-vault` | PDF de tickets par tenant | oui | oui |
| `uploads/proofs` | `/opt/mikrolan2/backend/uploads/proofs` | preuves historiques (ancien chemin) | oui | oui |
| `.env` | `/opt/mikrolan2/backend/.env` | secrets | oui | oui |
| `public/legal` | (dans l'archive, versionné dans Git) | CGU / confidentialité | remplacé par la version déployée | suit la version |

Aucun autre dossier métier (exports, `storage/`, `payments/`) n'est écrit par le code actuel. **Avant toute activation** : lister `/opt/mikrolan2/backend` sur le VPS pour confirmer qu'aucun autre dossier de données n'existe, et sauvegarder `private-uploads/` et `uploads/`. Tout nouveau chemin d'écriture ajouté au code doit être ajouté à la boucle `shared` de `deploy-release.sh` (le test « données privées partagées » le vérifie).

## Prérequis (à vérifier AVANT d'activer, sur le VPS, par le propriétaire)
1. `node -v` = **20.x** (le workflow construit avec Node 20). Sinon, ajuster `node-version` dans `ci.yml`.
2. Système compatible avec l'artefact construit sur Ubuntu 22.04 : `ldd --version` (glibc ≥ 2.35) et `openssl version` (3.x). À défaut, le contrôle « modules natifs » refuse la version avant toute bascule ; ajuster `runs-on` ou les `binaryTargets` Prisma.
3. `systemctl cat mikrolan-api` : relever `User`, `WorkingDirectory`, `EnvironmentFile`, `ReadWritePaths`. **Le fichier `backend/deploy/mikrolan-api.service` du dépôt cite encore `/opt/mikrolan/` (ancien chemin) : ne pas s'y fier.**
4. Secrets GitHub : `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (existants) et **`VPS_KNOWN_HOSTS`** (nouveau : sortie de `ssh-keyscan -t ed25519 <hôte>` vérifiée à la main). Environnement GitHub `production` (approbation recommandée).
5. L'ancien layout doit être **sain** : `/opt/mikrolan2/backend/dist/main.js` présent et le service qui répond.

## Installation unique (manuelle, en root, par le propriétaire)
```bash
# 1. Simulation (n'écrit rien) : relire ce qui serait fait
sudo DEPLOY_USER=<utilisateur-ssh-de-la-ci> bash backend/deploy/release/bootstrap-vps.sh
# 2. Après relecture, exécution
sudo DEPLOY_USER=<utilisateur-ssh-de-la-ci> bash backend/deploy/release/bootstrap-vps.sh --apply
```
Effets : crée `/opt/mikrolan2-releases` et le lien `current` → **l'ancien répertoire** (le service tourne toujours sur le même code), installe les scripts dans `/usr/local/lib/mikrolan-deploy` (propriété de root), un fragment systemd (`WorkingDirectory=…/current`) et un `sudoers` restreint à deux scripts, puis `daemon-reload`. **Aucun redémarrage.** Variables : `APP_ROOT`, `DATA_ROOT`, `RELEASES_DIR`, `SERVICE`, `SERVICE_USER`.

## Activation et premier déploiement
1. Choisir une **fenêtre calme**, surveiller `/api/health`, la mémoire et le swap.
2. Définir la variable de dépôt `DEPLOY_MODE=artifact` (Settings → Variables). Le prochain push sur `main` suit la nouvelle voie.
3. Contrôler : `current` pointe sur `/opt/mikrolan2-releases/<sha>`, `/api/health` répond 200, `deploys.log` contient `OK <sha>`.

## Retour arrière
- **Automatique** si la santé échoue après la bascule (journal : `ROLLED_BACK`).
- **Manuel** : workflow « Rollback production » (variable `target` vide = précédente), ou sur le VPS : `sudo /usr/local/lib/mikrolan-deploy/rollback.sh [sha]`.
- **Revenir à l'ancien mode** : supprimer (ou mettre à `legacy`) la variable `DEPLOY_MODE`. Le lien `current` peut être remis sur l'ancien répertoire avec `rollback.sh /opt/mikrolan2/backend`.

## Dépannage
| Symptôme | Cause probable | Action |
|---|---|---|
| « layout absent : exécuter bootstrap-vps.sh » | installation unique non faite | voir ci-dessus |
| « mémoire disponible insuffisante » | VPS déjà sous pression | attendre, vérifier `free -m`, `vps-capacity.md` |
| « modules natifs inutilisables » | architecture, glibc ou OpenSSL différents | `prerequis` 2 ; la version n'a pas été activée |
| « un autre déploiement est en cours » | verrou pris | attendre ; sinon `pgrep -f deploy-release` |
| `ROLLBACK_FAILED` dans `deploys.log` | ni la nouvelle ni l'ancienne version ne répondent | `deploy-interrupted.md` |
