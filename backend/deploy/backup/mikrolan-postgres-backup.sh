#!/usr/bin/env bash
# Root-only PostgreSQL backup wrapper for MikroLan — installé sur le VPS sous
# /usr/local/sbin/mikrolan-postgres-backup (root:root, 0750), appelé chaque nuit par
# /etc/cron.d/mikrolan-backup via une règle sudoers fixe, sans argument.
#
# Tout est fixé ici : aucun argument, aucune variable d'environnement de l'appelant,
# aucun fichier contrôlé par `mikrolan` n'est lu. Les identifiants S3 viennent du profil
# `backup` de l'utilisateur `ubuntu` (lisible par root uniquement).
set -euo pipefail
umask 077
export PATH=/usr/bin:/bin

if [ "$#" -ne 0 ]; then
  printf '%s\n' "mikrolan-postgres-backup: no arguments are accepted" >&2
  exit 1
fi

readonly CONTAINER="mikrolan2-pg"
readonly DB_USER="mikrolan"
readonly DB_NAME="mikrolan"
readonly DB_PORT="5544"
readonly BACKUP_DIR="/opt/mikrolan2/backups"
readonly RETENTION_DAYS=14
readonly LOG_FILE="/var/log/mikrolan-backup.log"
readonly S3_BUCKET="mikrolan-backups"
readonly AWS_PROFILE_NAME="backup"
readonly AWS_CREDENTIALS="/home/ubuntu/.aws/credentials"
readonly AWS_CONFIG="/home/ubuntu/.aws/config"
readonly TIMESTAMP="$(/usr/bin/date -u +%Y%m%d-%H%M%S)"
readonly OUT_FILE="${BACKUP_DIR}/mikrolan-${TIMESTAMP}.sql.gz"
readonly TMP_FILE="${OUT_FILE}.partial"
readonly START_EPOCH="$(/usr/bin/date +%s)"

log() {
  /usr/bin/printf '%s %s\n' "$(/usr/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "${LOG_FILE}"
}

cleanup_partial() {
  [ -f "${TMP_FILE}" ] && /usr/bin/rm -f "${TMP_FILE}"
}
trap cleanup_partial ERR

log "START backup"

DB_PASSWORD="$(/usr/bin/docker inspect "${CONTAINER}" --format '{{range .Config.Env}}{{println .}}{{end}}' | /usr/bin/grep '^POSTGRES_PASSWORD=' | /usr/bin/cut -d= -f2-)"

if ! /usr/bin/docker exec -e PGPASSWORD="${DB_PASSWORD}" "${CONTAINER}" \
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" -h 127.0.0.1 -p "${DB_PORT}" \
  | /usr/bin/gzip > "${TMP_FILE}"; then
  log "FAIL pg_dump"
  /usr/bin/rm -f "${TMP_FILE}"
  exit 1
fi

unset DB_PASSWORD

# gzip d'une entrée vide produit quand même ~20 octets : « -s » ne suffit pas.
# On exige l'en-tête d'un vrai dump pg_dump.
HEADER="$(/usr/bin/zcat "${TMP_FILE}" 2>/dev/null | /usr/bin/head -c 300 || true)"
case "${HEADER}" in
  *"PostgreSQL database dump"*) ;;
  *)
    log "FAIL invalid or empty dump"
    /usr/bin/rm -f "${TMP_FILE}"
    exit 1
    ;;
esac

/usr/bin/mv "${TMP_FILE}" "${OUT_FILE}"
/usr/bin/chown mikrolan:mikrolan "${OUT_FILE}"
/usr/bin/chmod 640 "${OUT_FILE}"

/usr/bin/find "${BACKUP_DIR}" -maxdepth 1 -name 'mikrolan-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete

SIZE="$(/usr/bin/stat -c %s "${OUT_FILE}")"
NAME="$(/usr/bin/basename "${OUT_FILE}")"

# Copie hors site. Un échec ne casse pas la sauvegarde locale, mais il est journalisé
# (« S3 FAIL ») et écrit sur stderr pour que le journal du cron le montre.
# L'envoi est vérifié : le fichier doit apparaître dans le bucket avec la même taille.
s3_upload() {
  export AWS_SHARED_CREDENTIALS_FILE="${AWS_CREDENTIALS}" AWS_CONFIG_FILE="${AWS_CONFIG}"
  /usr/bin/aws s3 cp --profile "${AWS_PROFILE_NAME}" "${OUT_FILE}" "s3://${S3_BUCKET}/${NAME}" --only-show-errors || return 1
  local remote
  remote="$(/usr/bin/aws s3 ls --profile "${AWS_PROFILE_NAME}" "s3://${S3_BUCKET}/${NAME}" | /usr/bin/awk '{print $3}')" || return 1
  [ "${remote}" = "${SIZE}" ]
}

S3_STATUS="OK"
if ! s3_upload; then
  S3_STATUS="FAIL"
  log "S3 FAIL file=${NAME}"
  /usr/bin/printf '%s\n' "mikrolan-postgres-backup: S3 upload failed for ${NAME}" >&2
fi

END_EPOCH="$(/usr/bin/date +%s)"
DURATION=$(( END_EPOCH - START_EPOCH ))

log "OK file=${OUT_FILE} size=${SIZE} duration=${DURATION}s s3=${S3_STATUS}"
