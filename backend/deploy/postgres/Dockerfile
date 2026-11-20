# Image Postgres de prod pour MikroLan avec pgBackRest intégré (PITR).
# Identique à postgres:16-alpine, plus le binaire pgbackrest et ses répertoires
# runtime. Inerte tant que archive_mode reste off : voir
# backend/deploy/backup/pitr/README.md pour l'activation (fenêtre de maintenance).
FROM postgres:16-alpine

RUN apk add --no-cache pgbackrest \
    && mkdir -p /var/log/pgbackrest /var/spool/pgbackrest \
    && chown postgres:postgres /var/log/pgbackrest /var/spool/pgbackrest \
    && chmod 750 /var/log/pgbackrest /var/spool/pgbackrest
