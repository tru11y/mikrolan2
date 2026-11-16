#!/usr/bin/env bash
# Installe (ou réinstalle) l'unit systemd mikrolan-api.service.
# Idempotent : safe à relancer. N'écrit rien si le fichier cible est déjà à jour.
#
# Usage :
#   sudo backend/deploy/systemd/install.sh            # installe depuis le repo
#   sudo SRC=/chemin/vers/mikrolan-api.service install.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SRC:-$here/mikrolan-api.service}"
DEST="${DEST:-/etc/systemd/system/mikrolan-api.service}"
SERVICE="${SERVICE:-mikrolan-api}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
REQUIRE_ROOT="${REQUIRE_ROOT:-1}"

log() { printf '%s [systemd-install] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERREUR: $*" >&2; exit 1; }

if [ "$REQUIRE_ROOT" = "1" ] && [ "$(id -u)" != "0" ]; then
  die "doit être exécuté en root (sudo)"
fi

[ -f "$SRC" ] || die "unit source introuvable : $SRC"

if [ -f "$DEST" ] && cmp -s "$SRC" "$DEST"; then
  log "unit déjà à jour : $DEST"
else
  install -m 0644 -o root -g root "$SRC" "$DEST"
  log "unit installé : $DEST"
fi

log "daemon-reload"
"$SYSTEMCTL" daemon-reload

if ! "$SYSTEMCTL" is-enabled --quiet "$SERVICE"; then
  log "enable au boot : $SERVICE"
  "$SYSTEMCTL" enable "$SERVICE"
else
  log "$SERVICE déjà enable"
fi

log "état :"
"$SYSTEMCTL" --no-pager status "$SERVICE" || true

log "terminé. Pour appliquer : sudo systemctl restart $SERVICE"
