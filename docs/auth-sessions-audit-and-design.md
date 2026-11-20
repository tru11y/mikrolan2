# Sessions MikroLan — audit, mesures et conception cible

Statut : **correctif implémenté** (Phase 2, branche `fix/auth-refresh-grace`). L'observabilité (Phase 1) reste en place ; voir §8 pour ce qui a été codé.

## 1. Cycle de vie actuel

```
Mobile (api.ts, SecureStore)                         Serveur (token.service.ts, table RefreshToken)
─────────────────────────────────                    ───────────────────────────────────────────────
login ─────────────────────────────────────────────▶ issueTokens : access JWT 15 min + refresh opaque 30 j
  ◀── {access, refresh} ───────────────────────────  (SHA-256 du refresh stocké, `family` = UUID de session)
  setAuthTokens : mémoire, puis 2 écritures
  SecureStore NON atomiques (access, puis refresh)

requête → 401 (access expiré)
  intercepteur : refresh unique en vol (single-flight JS)
  POST /auth/refresh {refresh} ──────────────────────▶ rotate :
                                                         1. inconnu            → 401 INVALID
                                                         2. revoked=true       → REUSE : révoque TOUTE la famille
                                                         3. expiré             → 401 EXPIRED
                                                         4. compte désactivé   → révoque la famille
                                                         5. claim atomique (updateMany where revoked=false)
                                                            count=0 (perdant d'une course) → REUSE : révoque la famille
                                                         6. émet le successeur (même famille), ancien = revoked=true
  ◀── nouveaux jetons ───────────────────────────────
  setAuthTokens (mémoire puis SecureStore)
  rejoue la requête

démarrage de l'app : lit SecureStore → api.auth.me() → (#128) erreur transitoire = jetons conservés
déconnexion : POST /auth/logout (révoque ce jeton) | « toutes les sessions » (révoque tous) | changement de mot de passe (révoque tous)
```

## 2. Chemins pouvant provoquer une déconnexion involontaire

| # | Chemin | Mécanisme | Statut |
|---|---|---|---|
| A | **Réponse de rafraîchissement perdue** | Le serveur a tourné le jeton, le téléphone ne reçoit pas la réponse (coupure, 4G/Wi-Fi, mode avion). Il rejoue l'ancien jeton → REUSE → **famille révoquée** | Non couvert par #128 |
| B | **App tuée pendant la rotation** | Android tue le processus entre la réponse et l'écriture `SecureStore` (2 écritures non atomiques) → l'ancien refresh reste stocké → rejeu au démarrage | Non couvert |
| C | **Deux rafraîchissements concurrents** | Deux appels avec le même jeton (deux processus JS, réessai après timeout) : le perdant de la consommation atomique révoque la famille **du gagnant** | Non couvert |
| D | Erreur réseau au démarrage / au rafraîchissement | Effaçait les jetons | **Corrigé (#128)** |
| E | « Se déconnecter de toutes les sessions » sans confirmation | Un tap involontaire révoque tout | À traiter (UX) |
| F | Changement/réinitialisation de mot de passe, compte supprimé | Déconnexion voulue | Normal |
| G | Refresh réellement expiré (30 j sans ouverture) | Déconnexion voulue | Normal |

La fréquence « environ tous les jours » signalée est **compatible** avec A/B/C mais **non prouvée** : le serveur ne journalisait aucune de ces causes.

## 3. Mesures mises en place par cette PR (Phase 1)

Événements structurés (journal du service, sans aucun secret ; références SHA-256 tronquées) : `REFRESH_SUCCESS`, `REFRESH_ROTATED`, `REFRESH_REUSE_DETECTED`, `REFRESH_FAMILY_REVOKED`, `REFRESH_EXPIRED`, `REFRESH_INVALID`, `LOGOUT_USER`, `LOGOUT_ALL_SESSIONS`, `PASSWORD_CHANGED`. Attributs : `userRef`, `tenantRef`, `familyId`, `cause`, durées.

- **Mesure clé** : `replayDelayMs` sur `REFRESH_REUSE_DETECTED` = délai entre la rotation et le rejeu. Quelques secondes ⇒ réponse perdue ou course (chemins A/B/C) ; plusieurs jours ⇒ vol probable.
- `cause` distingue `replay_of_revoked_token`, `concurrent_refresh`, `account_disabled`, `user_logout_all`, `change_password`.
- Événements critiques persistés dans `AuditLog` (`entityType=AuthSession`, métadonnées pseudonymisées). Aucune migration.
- Métriques : `GET /admin/system-health` → `authSessions` (`refreshSuccess24h`, `refreshReuseDetected24h`, `refreshFamilyRevoked24h`, `refreshExpired24h`, `logoutAllSessions24h`, `credentialsChanged24h`). Les compteurs de succès sont en mémoire (remise à zéro au redémarrage, `counterSince` l'indique).
- **Non instrumenté dans cette PR** : `DEVICE_REVOKED` (aucune notion de révocation d'appareil dans l'authentification ; les révocations de vendeurs `ticket-verifiers` et les suspensions `admin` révoquent des jetons sans événement), réinitialisation de mot de passe par e-mail (utilisateur inconnu dans la transaction). À ajouter avec la conception.

## 4. Conception cible (inspirée des pratiques Google / Microsoft)

Principes : rotation conservée ; tolérance aux pertes réseau, réponses perdues, crashs Android et rafraîchissements concurrents ; révocation ciblée ; protection contre le vol conservée.

**Modèle de données** (migration additive sur `RefreshToken`) : `rotatedAt`, `graceExpiresAt`, `successorId` (jeton émis à la rotation), `lastUsedAt`.

**Règle serveur** quand le jeton A (déjà tourné, successeur B) est présenté :
1. **Dans la fenêtre de grâce** (`now < rotatedAt + G`, G = 2 min à confirmer par les mesures) **et** B jamais utilisé : on **ne révoque pas** ; on finalise la rotation (nouveau jeton C dans la famille, B marqué remplacé) et on répond normalement. Journal `REFRESH_GRACE_REPLAY`.
2. **Hors fenêtre** ou B déjà utilisé par un autre appareil : comportement actuel (famille révoquée), `REFRESH_REUSE_DETECTED`.
3. **Course concurrente** : le perdant reçoit la réponse du gagnant (même successeur) au lieu de révoquer.
4. Une famille n'est révoquée que sur rejeu hors grâce, changement de mot de passe, « toutes les sessions », suppression/suspension.

**Client** : écriture atomique des deux jetons dans une seule valeur `SecureStore` (JSON versionné), lecture tolérante de l'ancien format ; conservation du jeton précédent jusqu'à la confirmation du suivant ; confirmation avant « toutes les sessions ».

**Impacts**
- *Sécurité* : fenêtre de rejeu bornée à G pour un jeton volé qui n'a pas encore été utilisé par le détenteur légitime ; le vol détecté après G ou après usage de B reste fatal pour la famille.
- *UX* : fin des déconnexions dues aux pertes de réponse, crashs et courses ; reconnexion forcée uniquement pour les cas F/G.
- *Migration* : colonnes nullables, anciens jetons sans `rotatedAt` traités comme hors grâce (comportement actuel). Déploiement serveur d'abord, puis client.
- *Rollback* : désactiver la grâce par variable `AUTH_REFRESH_GRACE_SECONDS=0` (retour exact au comportement actuel) ; colonnes laissées en place.

## 5. Plan de tests (reproduction avant correctif)

| Cas | Test | Statut |
|---|---|---|
| 1 réponse perdue, ancien jeton rejoué | `token.service.spec.ts` « rejeu… quelques secondes plus tard » | écrit (documente le comportement actuel) |
| 4 deux refresh simultanés | `token.service.spec.ts` « deux rafraîchissements simultanés » | écrit |
| 2 app tuée pendant la rotation | client : double écriture `SecureStore` interrompue | à écrire avec la conception |
| 3 réseau coupé après réponse | client + serveur | à écrire |
| 5–7 restauration après 12 h / 48 h / 7 j | e2e : restauration avec access expiré, refresh valide (TTL 30 j) | à écrire |
| 8 redémarrage du téléphone | appareil | manuel |
| 9 alternance Wi-Fi/4G, 10 mode avion prolongé | appareil (mode avion déjà validé avec #128) | manuel |

## 6. Ce qui reste à prouver avant de coder (§7)
Après déploiement de cette PR, lire sur 7 jours : `refreshReuseDetected24h`, `refreshFamilyRevoked24h`, répartition des `cause`, distribution de `replayDelayMs`, `logoutAllSessions24h`. **Décision** : si la majorité des révocations viennent de `replay_of_revoked_token` avec un délai de quelques secondes ou de `concurrent_refresh`, la conception du §4 est justifiée ; sinon la cause est ailleurs (E, F ou G) et le §4 n'est pas nécessaire.

## 7. Ordre de travail
1. Cette PR (observabilité) → déploiement CI → mesures sur 7 jours.
2. Conception validée sur les mesures.
3. Implémentation (serveur puis client), tests, validation sur copie de base, déploiement CI.

## 8. Correctif implémenté (Phase 2)

Fenêtre de grâce sur la rotation, pilotée par `AUTH_REFRESH_GRACE_SECONDS` (défaut 120 ; `0` = retour au comportement strict d'origine).

**Serveur** (`token.service.ts`)
- Migration additive `20261120120000_refresh_token_grace` : colonnes nullables `rotatedAt`, `graceExpiresAt` sur `RefreshToken`. Les jetons existants (`graceExpiresAt` NULL) sont hors grâce → comportement actuel conservé. Rollback : `AUTH_REFRESH_GRACE_SECONDS=0`, colonnes laissées en place.
- La consommation atomique pose `rotatedAt`/`graceExpiresAt` sur le jeton tourné.
- Rejeu d'un jeton déjà tourné (`handleRevokedReplay`) : **dans la grâce** (`now < graceExpiresAt`) **et** successeur non encore consommé (`successor.revoked = false`) → `REFRESH_GRACE_REPLAY`, réémission d'un jeton dans la famille, **aucune révocation** (couvre A réponse perdue, B crash au boot). **Hors grâce** ou successeur déjà utilisé → `REFRESH_REUSE_DETECTED` + révocation de la famille (vol).
- Rotation concurrente (perdant du claim atomique, chemin C) : relit l'état gagné et passe par la même grâce → le perdant obtient de nouveaux jetons au lieu de révoquer la famille du gagnant.
- Nouveau compteur `authSessions.refreshGraceReplay24h` (`GET /admin/system-health`).

**Sécurité** : un jeton volé mais pas encore utilisé par le détenteur légitime a une fenêtre de rejeu bornée à G=120 s ; détecté après G ou après usage du successeur, le vol reste fatal pour la famille. Déconnexion forcée conservée pour F/G (mot de passe, suppression, expiration 30 j).

**Client** (`mobile/src/lib/api.ts`, `authTokens.ts`)
- Écriture **atomique** de la paire en une seule valeur `SecureStore` (`mikrolan_auth_tokens`, JSON versionné `v:1`). Plus aucun état « access écrit, refresh pas encore » (chemin B).
- Lecture tolérante : migration transparente de l'ancien format à deux clés (purge après réécriture) ; valeur corrompue/incomplète → session absente (jamais à moitié restaurée).

**Tests** : `token.service.spec.ts` (grâce : rejeu toléré, successeur consommé → révoque, hors grâce → révoque, `grace=0` strict, concurrence tolérée) ; `authTokens.test.ts` (aller-retour, corrompu/incomplet → null). Backend 176 unit verts, mobile `test:unit` vert.

**Déploiement** : serveur d'abord (migration + API), puis client. `AUTH_REFRESH_GRACE_SECONDS` optionnel (défaut 120).
