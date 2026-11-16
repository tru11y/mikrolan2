#!/usr/bin/env bash
# Fonctions et réglages communs aux scripts de déploiement par artefact.
# Tout est surchargeable par variable d'environnement (les tests s'en servent).
# shellcheck shell=bash

APP_ROOT="${APP_ROOT:-/opt/mikrolan2}"
# Répertoire historique : reste la source des données persistantes (private-uploads, uploads, .env).
DATA_ROOT="${DATA_ROOT:-$APP_ROOT/backend}"
RELEASES_DIR="${RELEASES_DIR:-/opt/mikrolan2-releases}"
SERVICE="${SERVICE:-mikrolan-api}"
SERVICE_USER="${SERVICE_USER:-mikrolan}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3002/api/health}"
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-90}"
MIN_AVAIL_MB="${MIN_AVAIL_MB:-300}"
MAX_SWAP_USED_MB="${MAX_SWAP_USED_MB:-1700}"
MIN_DISK_MB="${MIN_DISK_MB:-1500}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
LOCK_FILE="${LOCK_FILE:-/var/lock/mikrolan-deploy.lock}"
MEMINFO="${MEMINFO:-/proc/meminfo}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
CURL="${CURL:-curl}"
CHOWN="${CHOWN:-chown}"
REQUIRE_ROOT="${REQUIRE_ROOT:-1}"
# Sauvegarde obligatoire avant toute migration (le script existant du dépôt).
BACKUP_CMD="${BACKUP_CMD:-$DATA_ROOT/deploy/backup/pg_backup.sh}"
# Commande de migration exécutée dans le répertoire de la nouvelle version, sous l'utilisateur du service.
MIGRATE_CMD="${MIGRATE_CMD:-}"
NODE_MAJOR_CMD="${NODE_MAJOR_CMD:-node -p process.versions.node.split('.')[0]}"
# Contrôle des modules natifs (argon2, moteur Prisma) sur CE serveur, avant toute migration ou bascule.
NODE_SMOKE_CMD="${NODE_SMOKE_CMD:-}"
SLEEP_CMD="${SLEEP_CMD:-sleep}"

log() { printf '%s [deploy] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERREUR: $*" >&2; exit 1; }

# Mémoire réellement disponible (Mo) et swap utilisé (Mo), lus dans /proc/meminfo.
meminfo_kb() { awk -v k="$1:" '$1 == k { print $2 }' "$MEMINFO"; }
mem_available_mb() { echo $(( $(meminfo_kb MemAvailable) / 1024 )); }
swap_used_mb() { echo $(( ( $(meminfo_kb SwapTotal) - $(meminfo_kb SwapFree) ) / 1024 )); }
disk_free_mb() { df -Pm "$1" | awk 'NR == 2 { print $4 }'; }

current_link() { printf '%s/current' "$RELEASES_DIR"; }
current_target() { readlink -f "$(current_link)"; }

# Bascule atomique du lien « current » (rename sur le même système de fichiers).
switch_to() {
  local target="$1" tmp
  tmp="$RELEASES_DIR/.current.new"
  ln -sfn "$target" "$tmp"
  mv -T "$tmp" "$(current_link)"
}

# Attend que l'API réponde 200 ; renvoie 1 au dépassement du délai.
wait_health() {
  local waited=0
  while [ "$waited" -lt "$HEALTH_TIMEOUT_S" ]; do
    if "$CURL" -fsS -m 3 -o /dev/null "$HEALTH_URL" 2>/dev/null; then
      log "santé OK après ${waited}s"
      return 0
    fi
    "$SLEEP_CMD" 2
    waited=$((waited + 2))
  done
  return 1
}

require_root() {
  if [ "$REQUIRE_ROOT" = "1" ] && [ "$(id -u)" != "0" ]; then
    die "ce script doit être exécuté en root (sudo)"
  fi
}

# Un seul déploiement/retour arrière à la fois ; le verrou est libéré à la fin du processus.
acquire_lock() {
  exec 9>"$LOCK_FILE" || die "impossible d'ouvrir le verrou $LOCK_FILE"
  flock -n 9 || die "un autre déploiement est en cours (verrou $LOCK_FILE)"
}

# Les trois protections avant toute modification : mémoire, swap, disque.
preflight_resources() {
  local avail swap disk
  avail="$(mem_available_mb)"
  swap="$(swap_used_mb)"
  disk="$(disk_free_mb "$RELEASES_DIR")"
  log "ressources : mémoire disponible ${avail} Mo (min ${MIN_AVAIL_MB}), swap utilisé ${swap} Mo (max ${MAX_SWAP_USED_MB}), disque libre ${disk} Mo (min ${MIN_DISK_MB})"
  [ "$avail" -ge "$MIN_AVAIL_MB" ] || die "mémoire disponible insuffisante (${avail} Mo < ${MIN_AVAIL_MB} Mo) : déploiement annulé, rien n'a été modifié"
  [ "$swap" -le "$MAX_SWAP_USED_MB" ] || die "swap trop utilisé (${swap} Mo > ${MAX_SWAP_USED_MB} Mo) : déploiement annulé, rien n'a été modifié"
  [ "$disk" -ge "$MIN_DISK_MB" ] || die "espace disque insuffisant (${disk} Mo < ${MIN_DISK_MB} Mo) : déploiement annulé"
}

record_deploy() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$RELEASES_DIR/deploys.log" 2>/dev/null || true
}

# Convertit une valeur MemoryHigh systemd (720M, 1.5G, 536870912, infinity) en octets.
# Retourne vide si la valeur est "infinity" ou non parsable.
to_bytes() {
  local v="$1"
  [ -z "$v" ] || [ "$v" = "infinity" ] || [ "$v" = "[not set]" ] && return 0
  local num unit
  if [[ "$v" =~ ^([0-9]+(\.[0-9]+)?)([KMGT]?)$ ]]; then
    num="${BASH_REMATCH[1]}"; unit="${BASH_REMATCH[3]}"
    case "$unit" in
      K) awk -v n="$num" 'BEGIN{ printf "%d", n * 1024 }' ;;
      M) awk -v n="$num" 'BEGIN{ printf "%d", n * 1024 * 1024 }' ;;
      G) awk -v n="$num" 'BEGIN{ printf "%d", n * 1024 * 1024 * 1024 }' ;;
      T) awk -v n="$num" 'BEGIN{ printf "%d", n * 1024 * 1024 * 1024 * 1024 }' ;;
      *) awk -v n="$num" 'BEGIN{ printf "%d", n }' ;;
    esac
  fi
}

# Lit la mémoire actuelle du service et alerte si > 80% de MemoryHigh.
# Jamais fatal : c'est une alerte, pas un critère de rollback. Les erreurs de lecture
# (service absent, systemctl indisponible) sont loguées en warning et le déploiement continue.
post_restart_rss_check() {
  local show cur_raw high_raw cur high threshold
  show="$("$SYSTEMCTL" show "$SERVICE" -p MemoryCurrent -p MemoryHigh 2>/dev/null || true)"
  if [ -z "$show" ]; then
    log "RSS post-restart : systemctl show indisponible, contrôle ignoré"
    return 0
  fi
  cur_raw="$(printf '%s\n' "$show" | awk -F= '$1 == "MemoryCurrent" { print $2 }')"
  high_raw="$(printf '%s\n' "$show" | awk -F= '$1 == "MemoryHigh" { print $2 }')"
  cur="$(to_bytes "$cur_raw")"
  high="$(to_bytes "$high_raw")"
  if [ -z "$cur" ] || [ "$cur" = "0" ]; then
    log "RSS post-restart : MemoryCurrent indisponible ($cur_raw), contrôle ignoré"
    return 0
  fi
  if [ -z "$high" ]; then
    log "RSS post-restart : $((cur / 1024 / 1024)) Mo (MemoryHigh non configuré : installer backend/deploy/systemd/mikrolan-api.service)"
    return 0
  fi
  threshold=$(( high * 80 / 100 ))
  if [ "$cur" -gt "$threshold" ]; then
    log "WARN RSS post-restart : $((cur / 1024 / 1024)) Mo > 80% de MemoryHigh ($((high / 1024 / 1024)) Mo) — surveiller / envisager bump (docs/runbooks/vps-resource-limits.md)"
  else
    log "RSS post-restart : $((cur / 1024 / 1024)) Mo / MemoryHigh $((high / 1024 / 1024)) Mo (OK)"
  fi
  return 0
}
