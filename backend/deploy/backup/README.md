# Sauvegarde PostgreSQL

## Ce qui tourne réellement en production

Chaque nuit à 03:00 UTC, `/etc/cron.d/mikrolan-backup` lance
`sudo -n /usr/local/sbin/mikrolan-postgres-backup` (règle sudoers fixe, sans argument).
Ce script root est la version installée de **`mikrolan-postgres-backup.sh`** (ce dossier).

Il fait, dans l'ordre :

1. `pg_dump` du conteneur `mikrolan2-pg`, compressé, écrit en `.partial` ;
2. refuse un dump vide ou sans l'en-tête `PostgreSQL database dump`
   (un `gzip` d'entrée vide fait ~20 octets : tester la taille ne suffit pas) ;
3. renomme en `/opt/mikrolan2/backups/mikrolan-AAAAMMJJ-HHMMSS.sql.gz` (640, `mikrolan`) ;
4. purge les dumps locaux de plus de 14 jours ;
5. **copie vers `s3://mikrolan-backups`** et **vérifie** que le fichier y est avec la même taille.

Journal : `/var/log/mikrolan-backup.log`. Chaque nuit, la dernière ligne doit finir par
`s3=OK`. `s3=FAIL` (et une ligne `S3 FAIL`) signale une copie hors site manquante : la
sauvegarde locale reste valide, mais la copie hors site est à réparer.

> `pg_backup.sh` (ancien script, avec cron utilisateur) n'est **plus utilisé** ; il est
> conservé pour mémoire.

## Installer ou mettre à jour le script sur le VPS (action manuelle, root)

Le dépôt ne déploie pas ce fichier : le CI ne touche pas `/usr/local/sbin`.

```bash
# depuis une copie à jour du dépôt, sur le VPS
sudo install -o root -g root -m 0750 backend/deploy/backup/mikrolan-postgres-backup.sh \
  /usr/local/sbin/mikrolan-postgres-backup
sudo /usr/local/sbin/mikrolan-postgres-backup     # essai immédiat
sudo tail -3 /var/log/mikrolan-backup.log          # doit finir par s3=OK
```

Identifiants S3 : profil `backup` de `/home/ubuntu/.aws/` (lu par root). L'utilisateur IAM
a besoin de `s3:PutObject` et `s3:ListBucket` sur `mikrolan-backups`.

## Rétention S3

Le script ne supprime rien dans S3 (pas de `s3:DeleteObject`). La rotation se règle par une
**règle de cycle de vie du bucket**, avec un profil AWS administrateur, par exemple 90 jours :

```bash
aws s3api put-bucket-lifecycle-configuration --bucket mikrolan-backups \
  --lifecycle-configuration '{"Rules":[{"ID":"expire-old-dumps","Status":"Enabled","Filter":{"Prefix":"mikrolan-"},"Expiration":{"Days":90}}]}'
```

## Tester qu'une sauvegarde se restaure

`restore-test.sh` rejoue un dump dans un PostgreSQL **jetable** (jamais la production) :

```bash
./backend/deploy/backup/restore-test.sh /chemin/mikrolan-AAAAMMJJ-HHMMSS.sql.gz
# → Restauration OK : N tables, ~M lignes
```

Le dump contient des données personnelles : le tester sur un poste de confiance uniquement.
À faire après chaque changement du script, puis au moins une fois par trimestre.

## Restaurer en production (incident)

À ne faire qu'après avoir arrêté le service et sauvegardé l'état actuel :

```bash
sudo systemctl stop mikrolan-api
# depuis S3 si le disque est perdu :
aws s3 cp --profile backup s3://mikrolan-backups/mikrolan-<horodatage>.sql.gz /tmp/
gunzip -c /tmp/mikrolan-<horodatage>.sql.gz | \
  sudo docker exec -i mikrolan2-pg psql -U mikrolan -d mikrolan -h 127.0.0.1 -p 5544
sudo systemctl start mikrolan-api
```

Un dump `pg_dump` standard recrée les objets : restaurer dans une base **vide** (ou
recréée), pas par-dessus des données existantes.

## Vérification automatique de restaurabilité (hebdomadaire)

Une sauvegarde non testée n'est pas une sauvegarde. `mikrolan-restore-verify.sh`
rejoue chaque semaine le dump le plus récent dans un PostgreSQL **jetable** (via
`restore-test.sh`) et journalise `RESTORE-VERIFY OK|FAIL` dans
`/var/log/mikrolan-restore.log`.

Installation sur le VPS (une fois) :

```bash
sudo install -D -m 755 restore-test.sh /usr/local/lib/mikrolan-backup/restore-test.sh
sudo install -D -m 755 mikrolan-restore-verify.sh /usr/local/lib/mikrolan-backup/mikrolan-restore-verify.sh
sudo install -D -m 644 systemd/mikrolan-restore-verify.service /etc/systemd/system/mikrolan-restore-verify.service
sudo install -D -m 644 systemd/mikrolan-restore-verify.timer   /etc/systemd/system/mikrolan-restore-verify.timer
sudo systemctl daemon-reload
sudo systemctl enable --now mikrolan-restore-verify.timer
# Vérifier : échéance planifiée + premier run manuel
systemctl list-timers mikrolan-restore-verify.timer
sudo systemctl start mikrolan-restore-verify.service && tail -n3 /var/log/mikrolan-restore.log
```

Alerting : faire remonter tout `RESTORE-VERIFY FAIL` du log (ou un `OnFailure=`
systemd) vers le canal d'astreinte.

## RPO : passer de 24 h à quelques minutes (PITR) — à appliquer en prod

La sauvegarde actuelle est **quotidienne** → RPO ≈ 24 h (jusqu'à une journée de
transactions perdue sur sinistre). Pour un système de paiement, viser un PITR
(Point-In-Time Recovery) par archivage WAL continu :

1. Postgres : `wal_level=replica`, `archive_mode=on`,
   `archive_command='... cp %p s3://mikrolan-backups/wal/%f'` (ou `wal-g`/`pgbackrest`).
2. Base de base hebdomadaire + flux WAL continu → restauration à l'instant T.
3. Mesurer et documenter RPO (minutes) et RTO cibles.

> Changement de **configuration production** : non appliqué par l'audit. Planifier
> une fenêtre de maintenance ; `pgbackrest` est recommandé (base + WAL + rétention
> + vérif intégrée) plutôt qu'un archivage WAL artisanal.
