# FreeRADIUS (PR3) — moteur protocole délégué à l'API

FreeRADIUS ne contient AUCUNE logique métier ni base locale : il reçoit les
Access-Request / Accounting-Request des routeurs MikroTik et délègue toute la
décision à l'API NestJS via `rlm_rest` (HTTP, loopback `127.0.0.1:3002`). La
réponse de l'API (Accept/Reject, débits, quota, Session-Timeout) est appliquée
telle quelle.

**Surface réseau : RADIUS n'est joignable QUE par le tunnel WireGuard
`wg-mgmt`.** Les sockets écoutent sur `10.20.0.1` (jamais `*`), et le firewall
n'ouvre `1812/1813` que sur `wg-mgmt` (cf. `backend/deploy/wg-mgmt.conf.example`).
Aucune ouverture sur l'IP publique.

## Pièces

| Fichier (dépôt) | Destination VPS | Rôle |
|---|---|---|
| `install-radius.sh` | — (lancé à la main, root) | installe/maj, idempotent |
| `freeradius/mods-available/rest` | `/etc/freeradius/3.0/mods-available/rest` | appels HTTP vers l'API |
| `freeradius/sites-available/mikrolan` | `/etc/freeradius/3.0/sites-available/mikrolan` | virtual server (remplace `default`) |
| `freeradius/mikrolan-secrets.conf.example` | `/etc/freeradius/3.0/mikrolan-secrets.conf` (à la main) | `X-Radius-Token` partagé |
| `freeradius/clients.conf.include.example` | doc | `$INCLUDE clients.d/` + bloc client type |
| `systemd/freeradius.service.d/mikrolan.conf` | `/etc/systemd/system/freeradius.service.d/mikrolan.conf` | ordre de démarrage, restart |
| `mikrolan-radius-sync` | `/usr/local/sbin/mikrolan-radius-sync` (root:root 0750) | synchronise les NAS depuis l'API |

## Mapping des clés JSON (rest ↔ API)

`mods-available/rest` POSTe un JSON **plat** dont les clés correspondent
exactement à `backend/src/modules/radius/dto/radius.schemas.ts`
(`authorizeSchema` / `accountingSchema`, helper `singleString`). On n'utilise
PAS l'encodage par défaut de `rlm_rest` (JSON imbriqué `{"attr":{"type","value":[...]}}`,
incompatible) : on passe par l'option `data` avec un gabarit explicite.

- authorize : `User-Name`, `NAS-IP-Address`, `Calling-Station-Id`.
- accounting : `User-Name`, `Acct-Status-Type`, `Acct-Session-Id`,
  `Acct-Unique-Session-Id`, `Acct-Input-Octets`, `Acct-Output-Octets`,
  `Acct-Input-Gigawords`, `Acct-Output-Gigawords`, `Acct-Session-Time`,
  `NAS-IP-Address`.

**Sécurité :** `NAS-IP-Address` vaut TOUJOURS `%{Packet-Src-IP-Address}` (IP
source UDP authentifiée par FreeRADIUS contre le secret par-client), JAMAIS
l'attribut `NAS-IP-Address` fourni par le NAS (falsifiable). L'API sélectionne
le tenant uniquement sur cette IP source (`resolveNas`) : un attribut client ne
peut pas désigner le tenant d'un autre (sinon bypass d'isolation cross-tenant).
La réponse `authorize` renvoie `control:Auth-Type` (`Accept`|`Reject`) et les
attributs `reply:` (dont `reply:Acct-Interim-Interval = 30`).

## Préfixe d'URL `/api`

L'API monte toutes ses routes sous `setGlobalPrefix('api')` (`backend/src/main.ts`).
Les endpoints réels sont donc **`/api/internal/radius/authorize`** et
**`/api/internal/radius/accounting`** (c'est ce qui est configuré dans
`mods-available/rest`).

## Installer / mettre à jour (manuel, root)

Le CI ne déploie rien sous `/etc/freeradius`, `/etc/systemd` ni
`/usr/local/sbin`. Tout se fait à la main sur le VPS, depuis une copie à jour du
dépôt.

```bash
# 1. Installe paquets + conf (idempotent)
sudo backend/deploy/radius/install-radius.sh

# 2. Pose le secret partagé (MÊME valeur que RADIUS_INTERNAL_TOKEN de backend/.env)
#    Groupe = utilisateur du démon : `freerad` (Debian/Ubuntu), `radiusd` (RHEL).
sudo install -o root -g freerad -m 0640 \
  backend/deploy/radius/freeradius/mikrolan-secrets.conf.example \
  /etc/freeradius/3.0/mikrolan-secrets.conf
sudo nano /etc/freeradius/3.0/mikrolan-secrets.conf   # remplacer le token

# 3. Pose le wrapper de synchro des NAS
sudo install -o root -g root -m 0750 \
  backend/deploy/radius/mikrolan-radius-sync /usr/local/sbin/mikrolan-radius-sync

# 4. Règle sudoers (mikrolan appelle le wrapper sans mot de passe, sans argument)
printf 'mikrolan ALL=(root) NOPASSWD: /usr/local/sbin/mikrolan-radius-sync\n' \
  | sudo install -o root -g root -m 0440 /dev/stdin /etc/sudoers.d/mikrolan-radius-sync
sudo visudo -cf /etc/sudoers.d/mikrolan-radius-sync   # vérifier la syntaxe

# 5. Vérifier la conf AVANT de démarrer, puis démarrer
sudo freeradius -XC          # doit afficher « Configuration appears to be OK »
sudo systemctl start freeradius
```

`install-radius.sh` supprime les symlinks `sites-enabled/default`,
`sites-enabled/inner-tunnel` et `mods-enabled/eap` (ce dernier exige une section
`Auth-Type EAP` qui ne vivait que dans `default` : laissé actif, il casse
`freeradius -XC`), active `mods-enabled/rest` et `sites-enabled/mikrolan`, et
ajoute `$INCLUDE clients.d/` à `clients.conf`.

## Flux de génération des clients (NAS)

L'API connaît les routeurs (`Router.radiusSecretEncrypted`, déchiffré par
`CryptoService`). Pour (ré)enrôler les NAS, elle génère le contenu complet de
`clients.d/mikrolan-clients.conf` (blocs `client router_<id> { ipaddr=10.20.0.x
secret=<...> nas_type=other shortname=... }`) et le **pipe** au wrapper :

```bash
printf '%s' "$CLIENTS_CONF" | sudo -n /usr/local/sbin/mikrolan-radius-sync
```

Le wrapper lit STDIN (jamais argv → aucun secret en ligne de commande/journal),
valide le format, écrit atomiquement `/etc/freeradius/3.0/clients.d/mikrolan-clients.conf`
(0600 `freerad:freerad` — l'utilisateur du démon), sérialise via `flock`, puis `systemctl reload
freeradius` (HUP, pas restart). Il journalise uniquement le nombre de clients et
un hash court — jamais un secret.

## Rotation du token interne

1. Générer un nouveau secret.
2. Mettre à jour `RADIUS_INTERNAL_TOKEN` dans `backend/.env`.
3. Mettre la MÊME valeur dans `/etc/freeradius/3.0/mikrolan-secrets.conf`.
4. `sudo systemctl reload freeradius` puis `sudo systemctl restart mikrolan-api`.

Les deux valeurs doivent toujours coïncider, sinon toute auth est rejetée
(fail-closed).

## CHECKLIST de validation (1 routeur test)

À faire après la première installation, depuis le VPS (RADIUS n'écoute que sur
`10.20.0.1`) ou depuis le routeur test via le tunnel.

1. **Access-Accept + VSA MikroTik** — abonnement actif :
   ```bash
   radtest -t pap <user> <pass> 10.20.0.1 0 <secret>
   # Attendu : Access-Accept, avec Session-Timeout et (si débit configuré)
   # Mikrotik-Rate-Limit / Mikrotik-Total-Limit, et Acct-Interim-Interval = 30.
   ```
2. **API down → Access-Reject** (fail-closed) :
   ```bash
   sudo systemctl stop mikrolan-api
   radtest -t pap <user> <pass> 10.20.0.1 0 <secret>   # Attendu : Access-Reject
   sudo systemctl start mikrolan-api
   ```
3. **Accounting Start / Interim / Stop** (via `radclient`) :
   ```bash
   printf 'User-Name=<user>,Acct-Status-Type=Start,Acct-Session-Id=test-1,Acct-Unique-Session-Id=test-1\n' \
     | radclient -x 10.20.0.1:1813 acct <secret>
   # idem Interim-Update puis Stop (avec Acct-Input/Output-Octets, Acct-Session-Time).
   ```
4. **Écoute bornée au tunnel** — seul `10.20.0.1` doit apparaître :
   ```bash
   sudo ss -ulpn | grep ':181'    # uniquement 10.20.0.1:1812 et 10.20.0.1:1813
   ```
5. **Fermé sur l'IP publique** :
   ```bash
   nmap -sU -p 1812,1813 <IP_PUBLIQUE_VPS>   # Attendu : filtered (jamais open)
   ```
6. **CoA / Disconnect (3799)** — si `RADIUS_COA_ENABLED` : vérifier qu'un
   paquet Disconnect est accepté via `wg-mgmt` et que `3799` reste fermé sur
   l'IP publique. (Le port 3799 n'est PAS ouvert par ce PR : l'ajouter aux
   règles `wg-mgmt` le jour où le CoA sortant/entrant est activé.)

## TODO / points dépendant de la machine (à vérifier sur le VPS)

- **Directive `header` de `rlm_rest`** : CONFIRMÉ OK sur le VPS (Ubuntu,
  `freeradius-rest` ≈ 3.0.26) — `header = "X-Radius-Token: ..."` dans la section
  `rest` est accepté par `freeradius -XC` (« Configuration appears to be OK »).
  Aucun repli (basic auth) nécessaire.
- **Dictionnaire MikroTik** : `Mikrotik-Rate-Limit` / `Mikrotik-Total-Limit`
  supposent `dictionary.mikrotik` chargé (fourni par le paquet freeradius).
  Vérifier dans `freeradius -XC` qu'aucun attribut inconnu n'est signalé.
- **Pool `${thread[pool]...}`** : les références héritent de `radiusd.conf`.
  Si une variable manque sur cette version, remplacer par des valeurs fixes
  (start=1, min=1, max=4, spare=2).
- **Chaîne vide sur attribut optionnel** : le schéma refuse `""` pour les
  `optionalString` (min(1)). En pratique MikroTik envoie toujours
  `Calling-Station-Id`. Si un NAS ne l'envoie pas, `authorize` renverra 400 →
  `fail` → reject. Durcissement éventuel (tolérer `""` côté API) hors scope PR3.
