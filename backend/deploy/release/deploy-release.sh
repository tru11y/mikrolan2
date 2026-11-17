#!/usr/bin/env bash
# Déploie une version précompilée (artefact construit en CI). N'installe RIEN avec npm sur le VPS et ne
# modifie jamais l'arborescence qui tourne : la nouvelle version est préparée à côté, puis activée par
# un changement atomique du lien « current ».
#
# Usage : deploy-release.sh <archive.tar.gz> <fichier.sha256> <sha-git>
#
# Ordre : verrou → vérifications (layout, somme de contrôle, mémoire, swap, disque) → extraction →
# données partagées → (sauvegarde + migration si nécessaire) → bascule + redémarrage → contrôle de santé →
# retour arrière automatique en cas d'échec → nettoyage des anciennes versions.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

# Une session SSH qui tombe ne doit pas interrompre le script au milieu de la bascule.
trap '' HUP

archive="${1:-}"; checksum_file="${2:-}"; sha="${3:-}"
[ -n "$archive" ] && [ -n "$checksum_file" ] && [ -n "$sha" ] || die "usage : deploy-release.sh <archive.tar.gz> <fichier.sha256> <sha-git>"
[[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || die "sha git invalide : $sha"

require_root
acquire_lock

staging=""
cleanup() { [ -n "$staging" ] && [ -d "$staging" ] && rm -rf "$staging"; return 0; }
trap cleanup EXIT

# 1. Le layout par versions doit avoir été installé (bootstrap-vps.sh), sinon on ne touche à rien.
[ -d "$RELEASES_DIR" ] || die "$RELEASES_DIR absent : exécuter d'abord bootstrap-vps.sh (voir docs/runbooks/deploy-artifact.md)"
[ -L "$(current_link)" ] || die "lien $(current_link) absent : exécuter d'abord bootstrap-vps.sh"
[ -f "$DATA_ROOT/.env" ] || die "$DATA_ROOT/.env introuvable"
[ -f "$archive" ] && [ -f "$checksum_file" ] || die "archive ou somme de contrôle introuvable"

# 2. Intégrité de l'archive.
expected="$(awk '{ print $1 }' "$checksum_file")"
actual="$(sha256sum "$archive" | awk '{ print $1 }')"
[ "$expected" = "$actual" ] || die "somme de contrôle différente (attendu $expected, obtenu $actual) : déploiement annulé"
log "archive vérifiée ($actual)"

# 3. Ressources : on s'arrête AVANT toute modification si le VPS est déjà sous pression.
preflight_resources

previous="$(current_target)"
log "version en service : $previous"

# 4. Extraction à côté de la version en service.
staging="$RELEASES_DIR/.staging-$sha"
rm -rf "$staging"
mkdir -p "$staging"
tar -xzf "$archive" -C "$staging"
[ -f "$staging/manifest.json" ] || die "manifest.json absent de l'archive"
grep -q "\"gitSha\": *\"$sha" "$staging/manifest.json" || die "le manifeste ne correspond pas au sha $sha"
want_node="$(sed -n 's/.*"nodeMajor": *"\{0,1\}\([0-9]*\).*/\1/p' "$staging/manifest.json" | head -1)"
have_node="$($NODE_MAJOR_CMD)"
[ -z "$want_node" ] || [ "$want_node" = "$have_node" ] || die "Node $have_node sur le serveur, l'archive est construite pour Node $want_node : déploiement annulé"
[ -f "$staging/dist/main.js" ] || die "dist/main.js absent de l'archive"

# 5. Données et configuration partagées : jamais copiées, toujours liées au répertoire historique.
for shared in private-uploads uploads; do
  mkdir -p "$DATA_ROOT/$shared"
  ln -sfn "$DATA_ROOT/$shared" "$staging/$shared"
done
ln -sfn "$DATA_ROOT/.env" "$staging/.env"
"$CHOWN" -R "$SERVICE_USER:$SERVICE_USER" "$staging" 2>/dev/null || [ "$REQUIRE_ROOT" != "1" ] || die "chown impossible"

target="$RELEASES_DIR/$sha"
if [ -d "$target" ]; then
  if [ "$(readlink -f "$target")" = "$previous" ]; then
    log "la version $sha est déjà en service : aucune bascule, contrôle de santé seulement"
    wait_health || die "la version déjà en service ne répond pas"
    exit 0
  fi
  rm -rf "$target"
fi
mv "$staging" "$target"
staging=""

# 5 bis. Les modules natifs doivent se charger sur CE serveur (architecture, glibc, OpenSSL) : sinon rien n'est activé.
log "contrôle des modules natifs"
if [ -n "$NODE_SMOKE_CMD" ]; then
  (cd "$target" && $NODE_SMOKE_CMD) || die "modules natifs inutilisables sur ce serveur : version non activée, service inchangé"
else
  runuser -u "$SERVICE_USER" -- bash -c "cd '$target' && node -e \"require('argon2')\" && node node_modules/prisma/build/index.js -v >/dev/null && node -e \"const { PrismaClient } = require('@prisma/client'); new PrismaClient().platformConfig.count().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); })\""     || die "modules natifs inutilisables sur ce serveur (argon2/Prisma) : version non activée, service inchangé"
fi

# 6. Migrations : sauvegarde obligatoire d'abord ; sans sauvegarde réussie, rien n'est migré ni basculé.
new_migrations=""
if [ -d "$target/prisma/migrations" ]; then
  for m in "$target"/prisma/migrations/*/; do
    name="$(basename "$m")"
    [ -d "$previous/prisma/migrations/$name" ] || new_migrations="$new_migrations $name"
  done
fi
if [ -n "$new_migrations" ]; then
  log "nouvelles migrations :${new_migrations}"
  [ -x "$BACKUP_CMD" ] || [ "$REQUIRE_ROOT" != "1" ] || die "script de sauvegarde introuvable ($BACKUP_CMD) : migration refusée"
  log "sauvegarde de la base avant migration"
  "$BACKUP_CMD" || die "la sauvegarde a échoué : migration et bascule annulées"
  log "migration"
  if [ -n "$MIGRATE_CMD" ]; then
    (cd "$target" && $MIGRATE_CMD) || die "la migration a échoué : version non activée, service inchangé"
  else
    runuser -u "$SERVICE_USER" -- bash -c "cd '$target' && node node_modules/prisma/build/index.js migrate deploy" \
      || die "la migration a échoué : version non activée, service inchangé"
  fi
else
  log "aucune nouvelle migration"
fi

# 7. Bascule atomique et redémarrage.
printf '%s\n' "$previous" > "$RELEASES_DIR/.previous"
switch_to "$target"
log "bascule vers $target, redémarrage de $SERVICE"
"$SYSTEMCTL" restart "$SERVICE" || true

# 8. Contrôle de santé ; sinon retour arrière automatique vers la version précédente.
if wait_health; then
  record_deploy "OK $sha (précédente : $previous)"
  post_restart_rss_check || true
else
  log "la nouvelle version ne répond pas : retour arrière vers $previous"
  switch_to "$previous"
  "$SYSTEMCTL" restart "$SERVICE" || true
  if wait_health; then
    record_deploy "ROLLED_BACK $sha → $previous"
    die "déploiement annulé automatiquement : la version précédente a été remise en service"
  fi
  record_deploy "ROLLBACK_FAILED $sha"
  die "la version précédente ne répond pas non plus : intervention manuelle nécessaire (docs/runbooks/deploy-interrupted.md)"
fi

# 9. Nettoyage : on garde les KEEP_RELEASES dernières versions, jamais la version en service ni la précédente.
keep_current="$(current_target)"
count=0
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  [ "$(basename "$dir")" = "current" ] && continue
  count=$((count + 1))
  [ "$count" -le "$KEEP_RELEASES" ] && continue
  [ "$(readlink -f "$dir")" = "$keep_current" ] && continue
  [ "$(readlink -f "$dir")" = "$previous" ] && continue
  log "suppression de l'ancienne version $(basename "$dir")"
  rm -rf "$dir"
done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
log "déploiement terminé : $sha"
