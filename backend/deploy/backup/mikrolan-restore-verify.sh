#!/usr/bin/env bash
# Vérification HEBDOMADAIRE de restaurabilité : prend le dump le plus récent et
# le rejoue dans un PostgreSQL JETABLE (via restore-test.sh, jamais la prod),
# puis journalise le résultat. Conçu pour tourner sous systemd timer (voir
# systemd/mikrolan-restore-verify.timer) ou cron. N'écrit JAMAIS dans la base
# de production ; aucune donnée ne quitte la machine.
#
# Sortie : 0 si la restauration réussit, !=0 sinon (le timer/alerting remonte l'échec).
set -euo pipefail

BACKUP_DIR="${MIKROLAN_BACKUP_DIR:-/opt/mikrolan2/backups}"
LOG="${MIKROLAN_RESTORE_LOG:-/var/log/mikrolan-restore.log}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "$(ts) $*" | tee -a "$LOG" >&2; }

latest="$(ls -1t "$BACKUP_DIR"/mikrolan-*.sql.gz 2>/dev/null | head -n1 || true)"
if [ -z "$latest" ]; then
  log "RESTORE-VERIFY FAIL: aucun dump dans $BACKUP_DIR"
  exit 1
fi

log "RESTORE-VERIFY START dump=$latest"
start=$(date +%s)
if out="$(bash "$HERE/restore-test.sh" "$latest" 2>&1)"; then
  dur=$(( $(date +%s) - start ))
  # restore-test.sh imprime : "Restauration OK : N tables, ~M lignes."
  log "RESTORE-VERIFY OK dump=$latest duration=${dur}s ${out##*$'\n'}"
  exit 0
else
  rc=$?
  log "RESTORE-VERIFY FAIL dump=$latest rc=$rc detail=${out##*$'\n'}"
  exit "$rc"
fi
