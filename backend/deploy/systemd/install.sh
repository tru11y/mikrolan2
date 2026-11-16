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

SERVICE_USER="${SERVICE_USER:-mikrolan}"
SERVICE_GROUP="${SERVICE_GROUP:-mikrolan}"
LOG_DIR="${LOG_DIR:-/var/log/mikrolan}"
USERADD="${USERADD:-useradd}"
GROUPADD="${GROUPADD:-groupadd}"
GETENT="${GETENT:-getent}"
MKDIR="${MKDIR:-mkdir}"
CHOWN="${CHOWN:-chown}"

log() { printf '%s [systemd-install] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERREUR: $*" >&2; exit 1; }

if [ "$REQUIRE_ROOT" = "1" ] && [ "$(id -u)" != "0" ]; then
  die "doit être exécuté en root (sudo)"
fi

[ -f "$SRC" ] || die "unit source introuvable : $SRC"

# User et groupe système requis par l'unit (idempotent).
if ! "$GETENT" group "$SERVICE_GROUP" >/dev/null; then
  log "création du groupe système : $SERVICE_GROUP"
  "$GROUPADD" --system "$SERVICE_GROUP"
else
  log "groupe $SERVICE_GROUP déjà présent"
fi
if ! "$GETENT" passwd "$SERVICE_USER" >/dev/null; then
  log "création de l'utilisateur système : $SERVICE_USER"
  "$USERADD" --system --gid "$SERVICE_GROUP" --no-create-home \
    --home-dir /nonexistent --shell /usr/sbin/nologin "$SERVICE_USER"
else
  log "utilisateur $SERVICE_USER déjà présent"
fi

# Répertoire de logs requis par ReadWritePaths de l'unit.
if [ ! -d "$LOG_DIR" ]; then
  log "création du répertoire de logs : $LOG_DIR"
  "$MKDIR" -p "$LOG_DIR"
fi
"$CHOWN" "$SERVICE_USER:$SERVICE_GROUP" "$LOG_DIR"

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

log "terminé. Les limites ne s'appliquent qu'au prochain démarrage : sudo systemctl restart $SERVICE"
