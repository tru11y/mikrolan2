#!/usr/bin/env bash
# Construit l'artefact de déploiement EN CI (ou en local) : le VPS ne compile et n'installe plus rien.
# Contenu : dist/, prisma/, public/, package*.json, node_modules de PRODUCTION uniquement (client Prisma
# généré), scripts de déploiement et manifest.json. Inclut aussi la console web Next.js (build autonome)
# dans web/ pour mikrolan-web.service. Sortie : <out>/mikrolan-api-<sha>.tar.gz + .sha256
#
# Usage (depuis la racine du dépôt) : backend/deploy/release/build-release.sh <dossier-de-sortie> <sha-git>
# Prérequis : Node de la MÊME version majeure que le serveur (le manifeste l'enregistre), même OS/architecture
# (modules natifs : argon2, moteur Prisma).
set -euo pipefail

out="${1:-}"; sha="${2:-}"
[ -n "$out" ] && [ -n "$sha" ] || { echo "usage : build-release.sh <dossier-de-sortie> <sha-git>" >&2; exit 2; }
[[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || { echo "sha git invalide : $sha" >&2; exit 2; }

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
backend="$root/backend"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$out"
out="$(cd "$out" && pwd)"

echo "== compilation (dépendances complètes, uniquement en CI)"
cd "$backend"
npm ci --legacy-peer-deps
npx prisma generate
npm run build
[ -f dist/main.js ] || { echo "dist/main.js absent après la compilation" >&2; exit 1; }

echo "== préparation du contenu"
cp -r dist prisma public package.json package-lock.json "$stage/"
mkdir -p "$stage/scripts"
cp deploy/release/lib.sh deploy/release/deploy-release.sh deploy/release/rollback.sh "$stage/scripts/"

echo "== dépendances de production seulement"
cd "$stage"
npm ci --omit=dev --legacy-peer-deps
npx prisma generate
node -e "require('argon2'); require('@prisma/client'); console.log('modules natifs chargés')"

echo "== console web (Next.js, build autonome)"
# NEXT_PUBLIC_API_BASE_URL est INLINÉE au build : elle fige l'URL de l'API dans le bundle client.
# Surchargeable pour un build de test ; par défaut l'API de production.
web_api_base="${NEXT_PUBLIC_API_BASE_URL:-https://api.mikrolan.net/api}"
cd "$root/web"
# npm install (pas `ci`) : le lockfile web peut dériver de package.json selon la
# plateforme de génération (sharp, variants OS) ; `install` résout proprement sur
# le Linux de CI sans échec de validation stricte.
npm install --legacy-peer-deps --no-audit --no-fund
NEXT_PUBLIC_API_BASE_URL="$web_api_base" npm run build
[ -f .next/standalone/server.js ] || { echo ".next/standalone/server.js absent : vérifier output:'standalone' dans web/next.config.mjs" >&2; exit 1; }
# L'artefact n'embarque que le standalone (server.js + node_modules élagué) + les assets statiques.
# Lancé par mikrolan-web.service : node server.js, cwd <sha>/web, PORT=3100.
mkdir -p "$stage/web/.next"
cp -r .next/standalone/. "$stage/web/"
cp -r .next/static "$stage/web/.next/static"
[ -d public ] && cp -r public "$stage/web/public"
cd "$stage"

echo "== manifeste"
node_major="$(node -p "process.versions.node.split('.')[0]")"
lock_sha="$(sha256sum package-lock.json | awk '{ print $1 }')"
migrations="$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort | tr '\n' ' ')"
cat > manifest.json <<EOF
{
  "gitSha": "$sha",
  "nodeMajor": "$node_major",
  "platform": "$(uname -s)-$(uname -m)",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "lockSha256": "$lock_sha",
  "migrations": "${migrations% }"
}
EOF

echo "== archive"
archive="$out/mikrolan-api-$sha.tar.gz"
tar --owner=0 --group=0 --numeric-owner -czf "$archive" -C "$stage" .
( cd "$out" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256" )
echo "archive : $archive ($(du -h "$archive" | cut -f1))"
cat "$archive.sha256"
