#!/usr/bin/env bash
# Installation UNIQUE du déploiement par versions sur le VPS. À exécuter à la main, en root, par le propriétaire
# du serveur, après relecture. Par défaut : SIMULATION (aucune modification). `--apply` pour exécuter.
#
# Ce que fait --apply (idempotent) :
#   1. crée $RELEASES_DIR et le lien « current » → l'ancien répertoire $DATA_ROOT (le service continue à tourner
#      sur le même code, rien ne change tant qu'un artefact n'est pas déployé) ;
#   2. installe les scripts dans /usr/local/lib/mikrolan-deploy (propriété de root) ;
#   3. installe le fragment systemd (WorkingDirectory = current) et l'autorisation sudo restreinte ;
#   4. recharge systemd (daemon-reload). Il NE REDÉMARRE PAS le service.
#
# Usage : bootstrap-vps.sh [--apply]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

apply=0
[ "${1:-}" = "--apply" ] && apply=1
INSTALL_DIR="${INSTALL_DIR:-/usr/local/lib/mikrolan-deploy}"
DROPIN_DIR="${DROPIN_DIR:-/etc/systemd/system/$SERVICE.service.d}"
SUDOERS_FILE="${SUDOERS_FILE:-/etc/sudoers.d/mikrolan-deploy}"
DEPLOY_USER="${DEPLOY_USER:-}"

run() {
  if [ "$apply" = "1" ]; then
    log "EXÉCUTION : $*"
    "$@"
  else
    log "SIMULATION : $*"
  fi
}

[ "$apply" = "0" ] && log "mode SIMULATION (ajouter --apply pour exécuter)"
[ "$apply" = "1" ] && require_root

# Vérifications préalables (lecture seule).
[ -d "$DATA_ROOT" ] || die "$DATA_ROOT introuvable"
[ -f "$DATA_ROOT/.env" ] || die "$DATA_ROOT/.env introuvable"
[ -f "$DATA_ROOT/dist/main.js" ] || die "$DATA_ROOT/dist/main.js introuvable : l'ancien layout doit être sain (voir docs/runbooks/deploy-interrupted.md)"
[ -n "$DEPLOY_USER" ] || die "DEPLOY_USER non défini : utilisateur SSH utilisé par la CI (variable DEPLOY_USER=...)"
if command -v systemctl >/dev/null 2>&1; then
  log "unité actuelle : $("$SYSTEMCTL" show "$SERVICE" -p FragmentPath --value 2>/dev/null || echo inconnue)"
  log "À VÉRIFIER avant --apply : 'systemctl cat $SERVICE' (WorkingDirectory, ReadWritePaths, User)"
fi

run mkdir -p "$RELEASES_DIR"
if [ ! -L "$(current_link)" ]; then
  run ln -sfn "$DATA_ROOT" "$(current_link)"
fi
run mkdir -p "$INSTALL_DIR"
for f in lib.sh deploy-release.sh rollback.sh; do
  run install -o root -g root -m 0755 "$here/$f" "$INSTALL_DIR/$f"
done

# Fragment systemd : le service démarre depuis le lien « current » et peut écrire dans les données partagées.
dropin="$(mktemp)"
trap 'rm -f "$dropin"' EXIT
cat > "$dropin" <<EOF
[Service]
WorkingDirectory=
WorkingDirectory=$RELEASES_DIR/current
ReadWritePaths=
ReadWritePaths=$DATA_ROOT $RELEASES_DIR
EOF
run mkdir -p "$DROPIN_DIR"
run install -o root -g root -m 0644 "$dropin" "$DROPIN_DIR/release.conf"

# sudo restreint : l'utilisateur de la CI ne peut lancer que ces deux scripts (et lire l'état du service).
sudoers="$(mktemp)"
cat > "$sudoers" <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: $INSTALL_DIR/deploy-release.sh *, $INSTALL_DIR/rollback.sh *
EOF
if command -v visudo >/dev/null 2>&1; then
  visudo -cf "$sudoers" >/dev/null || die "fragment sudoers invalide"
fi
run install -o root -g root -m 0440 "$sudoers" "$SUDOERS_FILE"
rm -f "$sudoers"

run "$SYSTEMCTL" daemon-reload
log "terminé. Le service n'a PAS été redémarré : il tourne toujours sur le code actuel."
log "Étape suivante : définir la variable GitHub DEPLOY_MODE=artifact (voir docs/runbooks/deploy-artifact.md)."
