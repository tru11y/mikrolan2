# PITR PostgreSQL via pgBackRest — runbook

> **Changement de configuration PRODUCTION — NON APPLIQUÉ.**
> Ce dossier ne contient que des **templates** (config + unités systemd + scripts). Rien
> n'est déployé ni exécuté sur la prod par cet audit. L'activation modifie la config
> Postgres (`wal_level`, `archive_mode`, `archive_command`) et **exige un redémarrage du
> conteneur `mikrolan2-pg`** : à réaliser par un humain en **fenêtre de maintenance**.
> Les secrets de `pgbackrest.conf` sont des placeholders `<...>` ; ne jamais committer de
> vraie clé.

## Pourquoi

La sauvegarde actuelle (`../README.md`) est un `pg_dump` quotidien → **RPO ≈ 24 h** : sur
sinistre, jusqu'à une journée de transactions de paiement perdue. Le PITR archive le flux
WAL en continu vers S3 et permet de restaurer **à l'instant T** (juste avant l'incident).

Le PITR **complète** le dump nightly, il ne le remplace pas : le dump reste un export
logique simple à inspecter / restaurer partiellement.

### Cibles

| Métrique | Avant (pg_dump) | Après (PITR pgBackRest) |
|----------|-----------------|--------------------------|
| RPO (perte max) | ~24 h | **quelques minutes** (dernier WAL archivé ; `archive_timeout` borne le pire cas) |
| RTO (temps de restauration) | durée d'un `psql` complet | base de base + rejeu WAL depuis la dernière full/diff — borné par la rétention diff quotidienne |

## Architecture

- Postgres tourne dans le conteneur Docker `mikrolan2-pg` (base `mikrolan`, port 5544).
- pgBackRest s'exécute **dans le conteneur** (`docker exec -u postgres mikrolan2-pg pgbackrest ...`)
  pour accéder au répertoire de données et au flux WAL.
- Dépôt distant : `s3://mikrolan-backups/pgbackrest` (préfixe dédié, isolé des dumps
  `mikrolan-*.sql.gz` à la racine du bucket). Chiffré client (aes-256-cbc) avant envoi.
- Planification : **full hebdo** (dimanche) + **diff quotidienne** + **WAL continu**.

### Prérequis conteneur

Le binaire `pgbackrest` doit être présent **dans** l'image `mikrolan2-pg` et les chemins
suivants doivent être montés/persistés (volume), partagés entre Postgres et pgBackRest :

- `/etc/pgbackrest/pgbackrest.conf` (le template de ce dossier, secrets renseignés) ;
- `/var/log/pgbackrest` et `/var/spool/pgbackrest` (spool de l'archivage asynchrone) ;
- le répertoire de données `pg1-path` (`/var/lib/postgresql/data`, déjà le volume de données).

Installer pgBackRest dans l'image (Debian/alpine selon la base de l'image), par ex. via le
Dockerfile ou un layer : `apt-get install -y pgbackrest`. Vérifier la version :
`docker exec -u postgres mikrolan2-pg pgbackrest version`.

## Secrets

Deux options, aucune ne committe de clé :

1. **Fichier** : renseigner `repo1-s3-key`, `repo1-s3-key-secret`, `repo1-cipher-pass`
   dans `/etc/pgbackrest/pgbackrest.conf` (0640, `postgres:postgres`).
2. **Variables d'environnement** (préférable, évite le secret au repos dans le conteneur) :
   `PGBACKREST_REPO1_S3_KEY`, `PGBACKREST_REPO1_S3_KEY_SECRET`, `PGBACKREST_REPO1_CIPHER_PASS`
   injectées dans l'environnement du conteneur (secrets Docker / compose `env_file` hors repo).

L'utilisateur IAM a besoin sur `mikrolan-backups` de `s3:PutObject`, `s3:GetObject`,
`s3:ListBucket` et `s3:DeleteObject` (pgBackRest gère sa propre rétention, contrairement au
dump nightly). La passphrase `repo1-cipher-pass` est **irremplaçable** : sans elle le dépôt
est illisible. La stocker dans le gestionnaire de secrets hors ligne de l'équipe.

## Activation (fenêtre de maintenance, humain, root)

### 1. Déposer la config

```bash
# depuis une copie à jour du dépôt, sur le VPS
sudo install -D -o root -g root -m 0640 \
  backend/deploy/backup/pitr/pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
# renseigner les placeholders <...> (clés S3 + passphrase), puis :
sudo chown postgres:postgres /etc/pgbackrest/pgbackrest.conf
# monter /etc/pgbackrest, /var/log/pgbackrest, /var/spool/pgbackrest dans le conteneur
# (volumes compose) et s'assurer que pgbackrest est installé dans l'image.
```

### 2. Configurer Postgres (nécessite redémarrage du conteneur)

Dans `postgresql.conf` (ou `ALTER SYSTEM`, puis restart car `wal_level`/`archive_mode`
sont `postmaster`) :

```
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --stanza=mikrolan archive-push %p'
archive_timeout = 60
max_wal_senders = 3
```

```bash
# appliquer puis redémarrer l'instance (FENÊTRE DE MAINTENANCE — coupure brève)
sudo docker restart mikrolan2-pg
docker exec -u postgres mikrolan2-pg psql -p 5544 -c 'SHOW wal_level; SHOW archive_mode;'
# → replica / on
```

### 3. Créer la stanza et la première base de base

```bash
sudo docker exec -u postgres mikrolan2-pg pgbackrest --stanza=mikrolan stanza-create
sudo docker exec -u postgres mikrolan2-pg pgbackrest --stanza=mikrolan check   # valide archivage WAL
sudo docker exec -u postgres mikrolan2-pg pgbackrest --stanza=mikrolan --type=full backup
sudo docker exec -u postgres mikrolan2-pg pgbackrest --stanza=mikrolan info    # doit lister 1 full
```

### 4. Installer les timers systemd

```bash
cd backend/deploy/backup/pitr/systemd
sudo install -D -m 644 pgbackrest-backup-full.service /etc/systemd/system/pgbackrest-backup-full.service
sudo install -D -m 644 pgbackrest-backup-full.timer   /etc/systemd/system/pgbackrest-backup-full.timer
sudo install -D -m 644 pgbackrest-backup-diff.service /etc/systemd/system/pgbackrest-backup-diff.service
sudo install -D -m 644 pgbackrest-backup-diff.timer   /etc/systemd/system/pgbackrest-backup-diff.timer
sudo systemctl daemon-reload
sudo systemctl enable --now pgbackrest-backup-full.timer pgbackrest-backup-diff.timer
systemctl list-timers 'pgbackrest-*'
```

Faire remonter tout échec vers l'astreinte (`OnFailure=` systemd ou supervision du log
`/var/log/pgbackrest`).

## Restauration PITR à l'instant T (incident, humain, root)

> Destructif : écrase le répertoire de données. Sauvegarder l'état courant avant, et viser
> un instant **juste avant** l'incident (ex. avant un `DELETE` accidentel ou une corruption).

```bash
# 1. Arrêter l'API et Postgres
sudo systemctl stop mikrolan-api
sudo docker stop mikrolan2-pg

# 2. Restaurer jusqu'à l'instant cible (le conteneur doit tourner avec Postgres arrêté,
#    ou utiliser un conteneur outil montant le volume de données). Exemple via docker run
#    outil partageant le volume de données et la config :
sudo docker run --rm \
  -v mikrolan2_pgdata:/var/lib/postgresql/data \
  -v /etc/pgbackrest:/etc/pgbackrest:ro \
  -v /var/log/pgbackrest:/var/log/pgbackrest \
  --user postgres <image_mikrolan2-pg> \
  pgbackrest --stanza=mikrolan --type=time \
    --target='2026-11-20 14:35:00+00' --target-action=promote --delta restore

# 3. Redémarrer Postgres : il rejoue les WAL jusqu'à la cible puis promeut l'instance.
sudo docker start mikrolan2-pg
docker exec -u postgres mikrolan2-pg psql -p 5544 -d mikrolan -c 'SELECT now();'

# 4. Contrôler les données, puis relancer l'API
sudo systemctl start mikrolan-api
```

Variantes de cible : `--type=time` (horodatage), `--type=xid` (transaction), `--type=name`
(restore point créé via `pg_create_restore_point`), `--type=immediate` (fin de la base de
base, sans rejeu WAL). Toujours `--delta` pour ne réécrire que les blocs différents.

## Vérification périodique

Une sauvegarde non testée n'est pas une sauvegarde (cf. `../README.md`). Au moins une fois
par trimestre, restaurer dans un **conteneur jetable** (jamais la prod) et contrôler
`pgbackrest --stanza=mikrolan info` (dernières full/diff + plage WAL continue, sans trou).
