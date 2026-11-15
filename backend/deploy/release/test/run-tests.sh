#!/usr/bin/env bash
# Tests des scripts de déploiement : aucun accès réseau, aucun service réel. Tout se passe dans un répertoire
# temporaire avec des substituts pour systemctl, curl et la sauvegarde. À lancer sous Linux (flock, GNU coreutils).
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rel="$(cd "$here/.." && pwd)"
failed=0; passed=0

ok()   { passed=$((passed + 1)); printf '  ok   %s\n' "$1"; }
fail() { failed=$((failed + 1)); printf '  FAIL %s\n' "$1"; }
check() { # check "description" commande...
  local d="$1"; shift
  if "$@"; then ok "$d"; else fail "$d"; fi
}

# ---- environnement isolé -----------------------------------------------------
setup() {
  T="$(mktemp -d)"
  export APP_ROOT="$T/app" DATA_ROOT="$T/app/backend" RELEASES_DIR="$T/releases"
  export LOCK_FILE="$T/lock" MEMINFO="$T/meminfo" REQUIRE_ROOT=0 SLEEP_CMD=true
  export CHOWN=true NODE_MAJOR_CMD="echo 20" HEALTH_TIMEOUT_S=4 MIN_DISK_MB=1
  export MIGRATE_CMD=true NODE_SMOKE_CMD=true KEEP_RELEASES=3
  mkdir -p "$DATA_ROOT/dist" "$DATA_ROOT/prisma/migrations/0001_init" "$DATA_ROOT/deploy/backup" "$RELEASES_DIR"
  : > "$DATA_ROOT/dist/main.js"; echo "SECRET=x" > "$DATA_ROOT/.env"
  ln -s "$DATA_ROOT" "$RELEASES_DIR/current"
  set_mem 600 1000 2000
  cat > "$T/systemctl" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$T/systemctl.log"
EOF
  cat > "$T/curl" <<EOF
#!/usr/bin/env bash
[ -f "\$(readlink -f "$RELEASES_DIR/current")/BAD" ] && exit 22
[ -f "$T/ALWAYS_DOWN" ] && exit 22
exit 0
EOF
  cat > "$T/backup" <<EOF
#!/usr/bin/env bash
echo backup >> "$T/backup.log"
exit \${BACKUP_RC:-0}
EOF
  chmod +x "$T/systemctl" "$T/curl" "$T/backup"
  export SYSTEMCTL="$T/systemctl" CURL="$T/curl" BACKUP_CMD="$T/backup"
}
set_mem() { # set_mem <dispo_Mo> <swap_utilisé_Mo> <swap_total_Mo>
  cat > "$MEMINFO" <<EOF
MemAvailable: $(( $1 * 1024 )) kB
SwapTotal: $(( $3 * 1024 )) kB
SwapFree: $(( ($3 - $2) * 1024 )) kB
EOF
}
make_archive() { # make_archive <sha> [--migration] [--bad] [--node 22]
  local sha="$1"; shift
  local stage="$T/stage-$sha" node=20 mig=0 bad=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --migration) mig=1 ;; --bad) bad=1 ;; --node) node="$2"; shift ;;
    esac
    shift
  done
  rm -rf "$stage"; mkdir -p "$stage/dist" "$stage/prisma/migrations/0001_init"
  : > "$stage/dist/main.js"
  [ "$mig" = 1 ] && mkdir -p "$stage/prisma/migrations/0002_nouvelle"
  [ "$bad" = 1 ] && : > "$stage/BAD"
  printf '{"gitSha":"%s","nodeMajor":"%s"}\n' "$sha" "$node" > "$stage/manifest.json"
  tar -czf "$T/$sha.tar.gz" -C "$stage" .
  ( cd "$T" && sha256sum "$sha.tar.gz" > "$sha.tar.gz.sha256" )
}
deploy() { bash "$rel/deploy-release.sh" "$T/$1.tar.gz" "$T/$1.tar.gz.sha256" "$1" > "$T/out.log" 2>&1; }
current_is() { [ "$(readlink -f "$RELEASES_DIR/current")" = "$(readlink -f "$1")" ]; }
count_restarts() { grep -c '^restart' "$T/systemctl.log" 2>/dev/null || echo 0; }
teardown() { rm -rf "$T"; }

# ---- scénarios ------------------------------------------------------------------
echo "déploiement nominal"
setup; make_archive abc1234
check "déploiement réussi" deploy abc1234
check "lien current vers la nouvelle version" current_is "$RELEASES_DIR/abc1234"
check "un seul redémarrage" test "$(count_restarts)" = 1
check "version précédente enregistrée" grep -q "$DATA_ROOT" "$RELEASES_DIR/.previous"
check ".env partagé (lien, jamais copié)" test -L "$RELEASES_DIR/abc1234/.env"
check "données privées partagées" test -L "$RELEASES_DIR/abc1234/private-uploads"
check "aucune migration → aucune sauvegarde" test ! -f "$T/backup.log"
teardown

echo "protections avant toute modification"
setup; make_archive abc1234; set_mem 150 100 2000
check "mémoire insuffisante : refus" bash -c "! deploy abc1234" 2>/dev/null || true
deploy abc1234 && fail "mémoire insuffisante : refus attendu" || ok "mémoire insuffisante : refus"
check "mémoire insuffisante : lien inchangé" current_is "$DATA_ROOT"
check "mémoire insuffisante : aucun redémarrage" test "$(count_restarts)" = 0
check "mémoire insuffisante : aucune extraction" test ! -d "$RELEASES_DIR/abc1234"
teardown

setup; make_archive abc1234; set_mem 600 1900 2000
deploy abc1234 && fail "swap saturé : refus attendu" || ok "swap saturé : refus"
check "swap saturé : lien inchangé" current_is "$DATA_ROOT"
teardown

setup; make_archive abc1234; echo "corrompu" >> "$T/abc1234.tar.gz"
deploy abc1234 && fail "archive corrompue : refus attendu" || ok "archive corrompue : refus"
check "archive corrompue : lien inchangé" current_is "$DATA_ROOT"
teardown

setup; make_archive abc1234 --node 22
deploy abc1234 && fail "mauvaise version de Node : refus attendu" || ok "mauvaise version de Node : refus"
check "mauvaise version de Node : lien inchangé" current_is "$DATA_ROOT"
teardown

setup; make_archive abc1234; rm "$RELEASES_DIR/current"
deploy abc1234 && fail "layout non installé : refus attendu" || ok "layout non installé : refus"
teardown

echo "verrou"
setup; make_archive abc1234
( exec 9>"$LOCK_FILE"; flock -n 9; sleep 4 ) &
holder=$!; sleep 1
deploy abc1234 && fail "déploiement concurrent : refus attendu" || ok "déploiement concurrent : refus"
check "message de verrou" grep -q "autre déploiement" "$T/out.log"
wait "$holder" 2>/dev/null
teardown

echo "santé et retour arrière automatique"
setup; make_archive bad0001 --bad
deploy bad0001 && fail "version défaillante : échec attendu" || ok "version défaillante : échec signalé"
check "retour automatique vers la version précédente" current_is "$DATA_ROOT"
check "deux redémarrages (bascule puis retour)" test "$(count_restarts)" = 2
check "journal : ROLLED_BACK" grep -q ROLLED_BACK "$RELEASES_DIR/deploys.log"
teardown

setup; make_archive bad0002 --bad; touch "$T/ALWAYS_DOWN"
deploy bad0002 && fail "tout est en panne : échec attendu" || ok "tout est en panne : échec signalé"
check "journal : ROLLBACK_FAILED" grep -q ROLLBACK_FAILED "$RELEASES_DIR/deploys.log"
teardown

echo "modules natifs"
setup; make_archive d0d0001; export NODE_SMOKE_CMD=false
deploy d0d0001 && fail "modules natifs en échec : refus attendu" || ok "modules natifs en échec : refus"
check "modules natifs en échec : lien inchangé" current_is "$DATA_ROOT"
check "modules natifs en échec : aucun redémarrage" test "$(count_restarts)" = 0
teardown

echo "migrations"
setup; make_archive e1a0001 --migration
check "migration avec sauvegarde : succès" deploy e1a0001
check "sauvegarde exécutée avant la migration" test -f "$T/backup.log"
check "nouvelle version activée" current_is "$RELEASES_DIR/e1a0001"
teardown

setup; make_archive e1a0002 --migration; export BACKUP_RC=1
deploy e1a0002 && fail "sauvegarde en échec : refus attendu" || ok "sauvegarde en échec : refus"
check "sauvegarde en échec : lien inchangé" current_is "$DATA_ROOT"
check "sauvegarde en échec : aucun redémarrage" test "$(count_restarts)" = 0
unset BACKUP_RC
teardown

setup; make_archive e1a0003 --migration; export MIGRATE_CMD=false
deploy e1a0003 && fail "migration en échec : refus attendu" || ok "migration en échec : refus"
check "migration en échec : lien inchangé" current_is "$DATA_ROOT"
check "migration en échec : aucun redémarrage" test "$(count_restarts)" = 0
teardown

echo "retour arrière manuel"
setup; make_archive aaa1111; make_archive bbb2222
deploy aaa1111 && deploy bbb2222
check "deux versions déployées" current_is "$RELEASES_DIR/bbb2222"
bash "$rel/rollback.sh" > "$T/rb.log" 2>&1
check "rollback vers la précédente" current_is "$RELEASES_DIR/aaa1111"
check "rollback vers un sha inconnu refusé" bash -c "! bash '$rel/rollback.sh' zzz9999 >/dev/null 2>&1"
teardown

echo "nettoyage des anciennes versions"
setup
for s in a000001 a000002 a000003 a000004 a000005; do make_archive "$s"; deploy "$s"; sleep 1; done
count="$(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.*' | wc -l)"
check "au plus KEEP_RELEASES versions conservées (+ précédente protégée)" test "$count" -le 4
check "version en service conservée" test -d "$RELEASES_DIR/a000005"
check "version précédente conservée" test -d "$RELEASES_DIR/a000004"
check "le répertoire de données n'est jamais supprimé" test -f "$DATA_ROOT/.env"
teardown

echo
echo "résultat : $passed réussis, $failed échoués"
[ "$failed" -eq 0 ]
