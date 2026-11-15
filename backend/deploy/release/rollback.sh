#!/usr/bin/env bash
# Retour arrière manuel vers la version précédente (ou vers un sha donné) : bascule du lien « current »,
# redémarrage, contrôle de santé. Ne touche ni à la base ni aux données.
# Usage : rollback.sh [sha-ou-chemin]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
trap '' HUP

require_root
acquire_lock

[ -L "$(current_link)" ] || die "lien $(current_link) absent : layout non installé"
now="$(current_target)"
want="${1:-}"
if [ -z "$want" ]; then
  [ -f "$RELEASES_DIR/.previous" ] || die "aucune version précédente enregistrée : indiquer un sha"
  want="$(cat "$RELEASES_DIR/.previous")"
fi
case "$want" in
  /*) target="$want" ;;
  *) target="$RELEASES_DIR/$want" ;;
esac
[ -d "$target" ] || die "version introuvable : $target"
target="$(readlink -f "$target")"
[ -f "$target/dist/main.js" ] || die "$target ne contient pas dist/main.js : version inutilisable"
[ "$target" != "$now" ] || die "la version demandée est déjà en service"

log "retour arrière : $now → $target"
printf '%s\n' "$now" > "$RELEASES_DIR/.previous"
switch_to "$target"
"$SYSTEMCTL" restart "$SERVICE" || true
if wait_health; then
  record_deploy "ROLLBACK_MANUAL $now → $target"
  log "retour arrière terminé"
else
  record_deploy "ROLLBACK_MANUAL_FAILED $now → $target"
  die "la version $target ne répond pas : intervention manuelle nécessaire (docs/runbooks/deploy-interrupted.md)"
fi
