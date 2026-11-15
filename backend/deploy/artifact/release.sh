#!/usr/bin/env bash
# Exécuté sur le VPS par le workflow. Usage: release.sh <sha> <artifact.tar.gz>
# Aucun npm/tsc/nest/prisma generate ici : l'artefact est déjà construit en CI.
set -euo pipefail

SHA="${1:?sha}"; ARTIFACT="${2:?artifact}"
ROOT="${MIKROLAN_ROOT:-/opt/mikrolan2}"
SERVICE="${MIKROLAN_SERVICE:-mikrolan-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3002/api/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
KEEP="${KEEP_RELEASES:-5}"
REL="$ROOT/releases/$SHA"
SHARED="$ROOT/shared"
CURRENT="$ROOT/current"
log() { echo "[release $SHA] $*"; }

preflight() {
  local free_mb swap_total swap_used swap_pct disk_free_pct
  free_mb=$(free -m | awk '/^Mem:/{print $7}')
  swap_total=$(free -m | awk '/^Swap:/{print $2}')
  swap_used=$(free -m | awk '/^Swap:/{print $3}')
  swap_pct=$(( swap_total > 0 ? swap_used * 100 / swap_total : 0 ))
  disk_free_pct=$(df --output=pcent "$ROOT" | tail -1 | tr -dc 0-9); disk_free_pct=$((100 - disk_free_pct))
  log "RAM dispo ${free_mb}Mo, swap ${swap_pct}%, disque libre ${disk_free_pct}%"
  [ "$free_mb" -ge 300 ] || { log "REFUS: RAM dispo < 300 Mo"; exit 10; }
  [ "$swap_pct" -le 75 ] || { log "REFUS: swap > 75 %"; exit 11; }
  [ "$disk_free_pct" -ge 20 ] || { log "REFUS: disque libre < 20 %"; exit 12; }
}

link_shared() {
  mkdir -p "$SHARED/private-uploads" "$SHARED/uploads" "$SHARED/env"
  ln -sfn "$SHARED/private-uploads" "$REL/private-uploads"
  ln -sfn "$SHARED/uploads" "$REL/uploads"
  ln -sfn "$SHARED/env/.env" "$REL/.env"
  [ -f "$SHARED/env/.env" ] || { log "REFUS: $SHARED/env/.env absent"; exit 13; }
}

migrations_changed() {
  [ -d "$CURRENT/prisma/migrations" ] || return 0
  ! diff -rq "$CURRENT/prisma/migrations" "$REL/prisma/migrations" >/dev/null
}

backup_db() {
  mkdir -p "$SHARED/backups"
  local out="$SHARED/backups/pre-$SHA-$(date +%Y%m%d%H%M%S).dump"
  # DATABASE_URL lue depuis le .env partagé sans l'exporter dans l'environnement global
  local url; url=$(grep -E '^DATABASE_URL=' "$SHARED/env/.env" | head -1 | cut -d= -f2- | tr -d '"')
  pg_dump -Fc --dbname="$url" -f "$out"
  [ -s "$out" ] || { log "REFUS: backup vide"; exit 14; }
  log "backup: $out"
}

healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while [ $SECONDS -lt $deadline ]; do
    if curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then return 0; fi
    sleep 3
  done
  return 1
}

rollback() {
  local prev="$1"
  if [ -z "$prev" ]; then log "pas de release précédente, rollback impossible"; return 1; fi
  log "ROLLBACK -> $prev"
  ln -sfn "$prev" "$CURRENT"
  systemctl restart "$SERVICE"
}

preflight
mkdir -p "$ROOT/releases"
PREV=""; [ -L "$CURRENT" ] && PREV=$(readlink -f "$CURRENT")
[ "$PREV" = "$REL" ] && { log "déjà déployée"; exit 0; }

rm -rf "$REL"; mkdir -p "$REL"
tar -xzf "$ARTIFACT" -C "$REL"
link_shared

if migrations_changed; then backup_db; else log "migrations inchangées: pas de backup"; fi

# Migration depuis la nouvelle release (CLI prisma incluse dans les deps prod). Échec => abort, aucune bascule.
(cd "$REL" && set -a && . ./.env && set +a && node_modules/.bin/prisma migrate deploy) \
  || { log "ABORT: migration échouée, aucune bascule"; rm -rf "$REL"; exit 20; }

ln -sfn "$REL" "$CURRENT"
systemctl restart "$SERVICE"

if healthy; then
  log "OK"
  ls -1dt "$ROOT"/releases/* | tail -n +$((KEEP + 1)) | grep -vxF "$PREV" | xargs -r rm -rf
else
  log "healthcheck KO après ${HEALTH_TIMEOUT}s"
  rollback "$PREV" || true
  exit 30
fi
