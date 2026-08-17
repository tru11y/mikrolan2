#!/usr/bin/env bash
set -euo pipefail

CONTAINER="mikrolan2-pg"
DB_USER="mikrolan"
DB_NAME="mikrolan"
DB_PORT="5544"
BACKUP_DIR="/opt/mikrolan2/backups"
RETENTION_DAYS=14
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="${BACKUP_DIR}/mikrolan-${TIMESTAMP}.sql.gz"

DB_PASSWORD="$(docker inspect "${CONTAINER}" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^POSTGRES_PASSWORD=' | cut -d= -f2-)"

docker exec -e PGPASSWORD="${DB_PASSWORD}" "${CONTAINER}" \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" -h 127.0.0.1 -p "${DB_PORT}" \
  | gzip > "${OUT_FILE}"

if [ ! -s "${OUT_FILE}" ]; then
  echo "Backup failed: ${OUT_FILE} is empty" >&2
  rm -f "${OUT_FILE}"
  exit 1
fi

find "${BACKUP_DIR}" -name 'mikrolan-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "Backup OK: ${OUT_FILE} ($(du -h "${OUT_FILE}" | cut -f1))"
