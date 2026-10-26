#!/usr/bin/env bash
# Teste qu'une sauvegarde se restaure : la rejoue dans un PostgreSQL JETABLE (conteneur
# éphémère, jamais la base de production) puis compte les tables et les lignes.
#
# Usage : ./restore-test.sh /chemin/mikrolan-AAAAMMJJ-HHMMSS.sql.gz
# Prérequis : Docker. À lancer sur un poste de confiance : le dump contient des données
# personnelles, ne pas le copier ailleurs que sur une machine sûre.
set -euo pipefail

DUMP="${1:?Usage: $0 <dump.sql.gz>}"
[ -s "${DUMP}" ] || { echo "Dump introuvable ou vide : ${DUMP}" >&2; exit 1; }
gzip -t "${DUMP}"

NAME="mikrolan-restore-test-$$"
PGPASS="$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
cleanup() { docker rm -f "${NAME}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "${NAME}" -e POSTGRES_PASSWORD="${PGPASS}" -e POSTGRES_USER=mikrolan -e POSTGRES_DB=mikrolan postgres:16 >/dev/null
for _ in $(seq 1 30); do
  docker exec "${NAME}" pg_isready -U mikrolan -d mikrolan >/dev/null 2>&1 && break
  sleep 1
done

gunzip -c "${DUMP}" | docker exec -i "${NAME}" psql -U mikrolan -d mikrolan -v ON_ERROR_STOP=1 -q >/dev/null

TABLES="$(docker exec "${NAME}" psql -U mikrolan -d mikrolan -tA -c "select count(*) from information_schema.tables where table_schema='public'")"
ROWS="$(docker exec "${NAME}" psql -U mikrolan -d mikrolan -tA -c "select coalesce(sum(n_live_tup),0)::bigint from pg_stat_user_tables")"
echo "Restauration OK : ${TABLES} tables, ~${ROWS} lignes (estimation pg_stat)."
