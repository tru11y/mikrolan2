#!/usr/bin/env bash
# Installe/maj FreeRADIUS pour MikroLan (Ubuntu 22.04) — root, idempotent.
#
# FreeRADIUS = pur moteur protocole : il délègue toute la décision à l'API
# NestJS via rlm_rest (loopback). RADIUS n'est joignable que par wg-mgmt.
#
# Usage (manuel, sur le VPS, depuis une copie à jour du dépôt) :
#   sudo backend/deploy/radius/install-radius.sh
#
# Ce script :
#   - installe freeradius + freeradius-rest + freeradius-utils (si absents) ;
#   - désactive le service tout de suite (on repart d'une conf maîtrisée) ;
#   - pose nos fichiers de conf (rest, virtual server, drop-in systemd) ;
#   - désactive les sites par défaut (default, inner-tunnel) et le module eap ;
#   - active le module rest et le site mikrolan ;
#   - prépare clients.d/ et l'inclusion dans clients.conf ;
#   - installe le wrapper root mikrolan-radius-sync + le couple d'units
#     path/service qui appliquent le spool écrit par l'API ;
#   - daemon-reload + enable.
#
# Il NE pose PAS le secret ni les clients : mikrolan-secrets.conf est posé à la
# main (modèle .example) et clients.d/mikrolan-clients.conf est écrit par le
# wrapper mikrolan-radius-sync, déclenché par l'unit path quand l'API dépose le
# spool /opt/mikrolan2/backend/run/radius-clients.req. Aucun sudo (l'API tourne
# avec NoNewPrivileges) : découplage spool + systemd path-unit.
set -euo pipefail
umask 022
export DEBIAN_FRONTEND=noninteractive

if [ "$(id -u)" -ne 0 ]; then
  echo "Ce script doit être lancé en root." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly SRC="${SCRIPT_DIR}/freeradius"
readonly FR_DIR="/etc/freeradius/3.0"
readonly PACKAGES="freeradius freeradius-rest freeradius-utils"

log() { printf '%s [install-radius] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# ── 1. Paquets (idempotent : dpkg -s avant apt) ──────────────────────────────
missing=""
# shellcheck disable=SC2086  # découpage en mots volontaire sur la liste de paquets
for pkg in ${PACKAGES}; do
  if ! dpkg -s "${pkg}" >/dev/null 2>&1; then
    missing="${missing} ${pkg}"
  fi
done

if [ -n "${missing}" ]; then
  log "installation des paquets :${missing}"
  apt-get update -qq
  # shellcheck disable=SC2086  # liste de paquets volontairement éclatée
  apt-get install -y -qq ${missing}
else
  log "paquets déjà présents (${PACKAGES})"
fi

# ── 2. Repartir d'une conf maîtrisée ─────────────────────────────────────────
# Le paquet active et démarre freeradius avec la conf par défaut : on coupe.
log "désactivation du service par défaut"
systemctl disable --now freeradius >/dev/null 2>&1 || true

if [ ! -d "${FR_DIR}" ]; then
  echo "Répertoire ${FR_DIR} introuvable : version de freeradius inattendue." >&2
  exit 1
fi

# Compte système du démon (créé par le paquet) : `freerad` sur Debian/Ubuntu,
# `radiusd` sur RHEL. Ne JAMAIS supposer `freeradius` : cet utilisateur n'existe
# pas → `install -o freeradius` échoue « invalid user » et laisse l'install à
# moitié faite.
FR_USER=""
for u in freerad radiusd freeradius; do
  if id "$u" >/dev/null 2>&1; then FR_USER="$u"; break; fi
done
readonly FR_USER
if [ -z "${FR_USER}" ]; then
  echo "Utilisateur système freeradius introuvable (ni freerad ni radiusd)." >&2
  exit 1
fi
log "utilisateur du démon : ${FR_USER}"

# ── 3. Pose des fichiers de conf (propriété du démon) ────────────────────────
log "pose du module rest"
install -o "${FR_USER}" -g "${FR_USER}" -m 0640 \
  "${SRC}/mods-available/rest" "${FR_DIR}/mods-available/rest"

log "pose du virtual server mikrolan"
install -o "${FR_USER}" -g "${FR_USER}" -m 0640 \
  "${SRC}/sites-available/mikrolan" "${FR_DIR}/sites-available/mikrolan"

# ── 4. Désactivation des sites et modules par défaut (idempotent) ────────────
log "désactivation des sites par défaut"
rm -f "${FR_DIR}/sites-enabled/default" "${FR_DIR}/sites-enabled/inner-tunnel"

# Le module eap par défaut exige une section `Auth-Type EAP` qui ne vivait que
# dans le site `default` (désactivé ci-dessus) : laissé actif, il casse
# l'instanciation (`freeradius -XC` → « Failed to find 'Auth-Type EAP' »). Le
# hotspot MikroTik n'utilise pas EAP (PAP/CHAP délégué à l'API) → on le coupe.
log "désactivation du module eap (non utilisé, casse -XC)"
rm -f "${FR_DIR}/mods-enabled/eap"

# ── 5. Activation module + site (symlinks idempotents) ───────────────────────
log "activation du module rest et du site mikrolan"
ln -sfn "../mods-available/rest" "${FR_DIR}/mods-enabled/rest"
ln -sfn "../sites-available/mikrolan" "${FR_DIR}/sites-enabled/mikrolan"

# ── 6. clients.d/ + inclusion dans clients.conf (idempotent) ─────────────────
log "préparation de clients.d/"
install -d -o "${FR_USER}" -g "${FR_USER}" -m 0750 "${FR_DIR}/clients.d"

if ! grep -qE '^\s*\$INCLUDE\s+clients\.d/\s*$' "${FR_DIR}/clients.conf"; then
  log "ajout de \$INCLUDE clients.d/ dans clients.conf"
  printf '\n# MikroLan — clients gérés dynamiquement par l'"'"'API (mikrolan-radius-sync)\n$INCLUDE clients.d/\n' \
    >> "${FR_DIR}/clients.conf"
fi

# ── 7. Wrapper root + spool + units path/service (chaînon API → FreeRADIUS) ───
# L'API (user `mikrolan`) tourne avec NoNewPrivileges=true : elle NE PEUT PAS
# `sudo`. Découplage : l'API écrit atomiquement le contenu de clients.conf dans
# le spool SPOOL_FILE (sous /opt/mikrolan2/backend, seul emplacement inscriptible
# vu ProtectSystem=strict) ; l'unit `mikrolan-radius-sync.path` le surveille et
# déclenche le service root oneshot `mikrolan-radius-sync.service`, qui pipe le
# spool dans le wrapper (STDIN only : valide, écrit clients.d/, reload). Aucun
# secret en argv/journal, aucune escalade dans l'API.
readonly API_USER="${MIKROLAN_API_USER:-mikrolan}"
readonly WRAPPER_DEST="/usr/local/sbin/mikrolan-radius-sync"
readonly SPOOL_DIR="${MIKROLAN_SPOOL_DIR:-/opt/mikrolan2/backend/run}"
# Le fichier spool lui-même (${SPOOL_DIR}/radius-clients.req) est écrit par l'API
# et référencé par les units systemd ; le script ne pose que le répertoire.

log "pose du wrapper ${WRAPPER_DEST}"
install -o root -g root -m 0750 "${SCRIPT_DIR}/mikrolan-radius-sync" "${WRAPPER_DEST}"

# Ancienne règle sudoers (approche sudo, incompatible NoNewPrivileges) : purge.
if [ -f /etc/sudoers.d/mikrolan-radius ]; then
  log "retrait de l'ancienne règle sudoers /etc/sudoers.d/mikrolan-radius (obsolète)"
  rm -f /etc/sudoers.d/mikrolan-radius
fi

if id "${API_USER}" >/dev/null 2>&1; then
  log "préparation du spool ${SPOOL_DIR} (owner ${API_USER})"
  install -d -o "${API_USER}" -g "${API_USER}" -m 0750 "${SPOOL_DIR}"
else
  log "ATTENTION : utilisateur API '${API_USER}' introuvable — spool NON préparé."
  log "  Relancez avec MIKROLAN_API_USER=<user> une fois l'API déployée."
fi

log "pose des units path/service"
install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/systemd/mikrolan-radius-sync.path" \
  /etc/systemd/system/mikrolan-radius-sync.path
install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/systemd/mikrolan-radius-sync.service" \
  /etc/systemd/system/mikrolan-radius-sync.service

# ── 8. Drop-in systemd ───────────────────────────────────────────────────────
log "pose du drop-in systemd"
install -d -o root -g root -m 0755 /etc/systemd/system/freeradius.service.d
install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/systemd/freeradius.service.d/mikrolan.conf" \
  /etc/systemd/system/freeradius.service.d/mikrolan.conf

systemctl daemon-reload

log "activation de l'unit path mikrolan-radius-sync.path"
systemctl enable --now mikrolan-radius-sync.path >/dev/null 2>&1 || true

# ── 9. Vérifications ─────────────────────────────────────────────────────────
if [ ! -f "${FR_DIR}/mikrolan-secrets.conf" ]; then
  log "ATTENTION : ${FR_DIR}/mikrolan-secrets.conf absent."
  log "  Posez-le à la main (0640 root:${FR_USER}) avant de démarrer :"
  log "  cp mikrolan-secrets.conf.example ${FR_DIR}/mikrolan-secrets.conf && editez le token."
fi

log "activation (enable) du service freeradius"
systemctl enable freeradius >/dev/null 2>&1 || true

log "terminé. Démarrage : vérifier 'freeradius -XC' puis 'systemctl start freeradius'."
