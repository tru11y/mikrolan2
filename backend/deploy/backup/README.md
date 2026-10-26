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
