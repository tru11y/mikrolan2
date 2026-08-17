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

## Limite connue

Les backups sont stockés uniquement sur le VPS — une perte totale du serveur (disque, résiliation) emporte aussi les backups. Pas de copie externe (S3/Backblaze) pour l'instant, décision volontaire pour rester simple au démarrage.
