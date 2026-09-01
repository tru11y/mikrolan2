# Backup Postgres

`pg_backup.sh` fait un `pg_dump` quotidien du conteneur `mikrolan2-pg`, compressé, dans `/opt/mikrolan2/backups/`. Rétention 14 jours (purge automatique des dumps plus anciens).

Installé sur le VPS via cron (`crontab -l` en tant qu'utilisateur `ubuntu`) :

```
0 3 * * * /opt/mikrolan2/backups/pg_backup.sh >> /opt/mikrolan2/backups/backup.log 2>&1
```

## Restaurer un backup

```bash
gunzip -c /opt/mikrolan2/backups/mikrolan-<timestamp>.sql.gz | \
  docker exec -i mikrolan2-pg psql -U mikrolan -d mikrolan -h 127.0.0.1 -p 5544
```

## Backup off-site (S3)

Chaque backup est uploadé automatiquement vers `s3://mikrolan-backups` (us-east-1) via le profil AWS `backup` (`~/.aws/credentials`).

- IAM user : `mikrolan-backup-writer` (politique `s3-backup-write` : `s3:PutObject` uniquement)
- Le script ne fail pas si l'upload S3 échoue — le backup local reste disponible
- Pas de `s3:DeleteObject` : les backups S3 ne peuvent pas être supprimés par le script (protection contre suppression accidentelle)

Pour restaurer depuis S3 :

```bash
aws s3 cp --profile backup s3://mikrolan-backups/mikrolan-<timestamp>.sql.gz /tmp/
gunzip -c /tmp/mikrolan-<timestamp>.sql.gz | \
  docker exec -i mikrolan2-pg psql -U mikrolan -d mikrolan -h 127.0.0.1 -p 5544
```
