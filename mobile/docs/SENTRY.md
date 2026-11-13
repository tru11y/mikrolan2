# Sentry mobile — activation

**État par défaut : inactif.** `src/lib/sentry.ts` n'initialise Sentry que si `EXPO_PUBLIC_SENTRY_DSN` est défini au build, une seule fois (`applySentry`). Aucun DSN dans le dépôt.

## Variables
| Variable | Rôle | Où | Dans l'APK |
|---|---|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` (secret CI `SENTRY_DSN_MOBILE`) | destination des événements | env du build uniquement | oui (DSN public par conception) |
| `EXPO_PUBLIC_SENTRY_ENV` | `production` / `staging` / `devtest` / `development` | env du build | oui |
| `SENTRY_AUTH_TOKEN` | upload des sourcemaps | CI uniquement | **jamais** |
| `SENTRY_ORG` / `SENTRY_PROJECT` | cible de l'upload (déjà dans `app.json`) | CI | non |

Build local : `EXPO_PUBLIC_SENTRY_DSN=... ./gradlew assembleRelease` (jamais écrit dans un fichier suivi, jamais affiché).
Le job CI actuel ne construit pas l'APK : l'injection se fait au build manuel signé, ou dans un futur workflow via `secrets.SENTRY_DSN_MOBILE` (sans `echo`, sans `set -x`).

## Configuration (`sentryConfig.ts`, testée)
- `release` = `<package>@<versionName>+<versionCode>` et `dist` = versionCode, lus dans la configuration Expo construite (rien en dur).
- production : traces 0.05 ; staging/devtest/development : 0.2. Profiling 0, replay 0 (session et erreur), pas de capture d'écran, pas de hiérarchie de vues, `debug` false, `sendDefaultPii` false.

## Intégrations automatiques (SDK 7.2.0, configuration effective)
- Breadcrumbs : seuls fetch et XHR sont gardés ; console, DOM et navigation sont désactivés dans `sentry.ts`. Chaque breadcrumb réseau est réduit par `beforeBreadcrumb` à méthode, route normalisée, statut, durée.
- Actifs par défaut : handlers d'erreurs React Native, erreurs liées, contexte appareil (modèle, OS, mémoire), contexte release, suivi de session, crash natif.
- Inactifs par défaut : user interaction tracing, httpClient (capture des requêtes en échec), logs, screenshot, view hierarchy, replay.
- `sendDefaultPii: false` empêche l'ajout automatique de l'IP et de l'identité utilisateur. Il n'empêche PAS : les messages d'erreur, les URL, le contexte appareil, ni les événements natifs (crash natif envoyé par le SDK Android sans passer par `beforeSend` JS). Ces points sont traités par le scrubber et la réduction à l'émission.
- SDK natif Android (sentry-android 8.21.1) : le manifeste désactive PII, capture d'écran, hiérarchie de vues et les breadcrumbs d'interaction, système, réseau et composants (`io.sentry.*`, vérifié par `sentryNative.static.test.ts`). Le plugin Expo `plugins/withSentryNativeHardening.js` (déclaré dans `app.json`) réécrit ces clés à chaque `expo prebuild` (idempotent) : prouvé sur une copie jetable avec deux prebuild successifs puis un `--clean` (7 clés, une occurrence chacune), et un contrôle négatif sans plugin (0 clé). Attention : un `prebuild --clean` régénère aussi les permissions du manifeste (ex. ajout de RECORD_AUDIO et SYSTEM_ALERT_WINDOW, retrait d'ACCESS_NETWORK_STATE) : ne jamais le lancer dans le dépôt sans revue.
- **À vérifier sur le build de laboratoire** : le contenu d'un crash natif (le scrubber JS ne s'y applique pas) et que le SDK natif lit bien ces clés alors que l'init est faite par le JS.

## Nettoyage (`sentryScrub.ts`)
- Événement : message, exceptions, extra, contexts, tags nettoyés ; `user` vidé ; corps/cookies de requête supprimés ; URL réduite à la route.
- Route normalisée : chemin seul (ni hôte, ni query, ni fragment) ; seuls les segments en minuscules/tirets (20 car. max) sont gardés, tout le reste devient `:id` (UUID, CUID, ULID, ObjectId, codes de ticket ou de lot, nombres).
- Motifs masqués : Bearer, JWT, e-mail, téléphone, IPv4/IPv6, MAC, clé WireGuard, paramètres d'URL sensibles ; clés sensibles (password, token, code, cred, saspay, identifiants routeur/lot/ticket/plan/tenant…).
- Réduction à l'émission : `reportSilent` n'envoie que des nombres/booléens en `data` ; plus aucun identifiant ni nom.

## Sourcemaps
Audit (SDK 7.2.0) :
- `build.gradle` applique `sentry.gradle` seulement si `SENTRY_AUTH_TOKEN` est défini. Sans token, rien n'est envoyé et le build de laboratoire n'est pas bloqué ; `SENTRY_DISABLE_AUTO_UPLOAD=true` désactive aussi l'envoi.
- Token présent mais mal configuré (org/projet/token invalides) : la tâche `Exec` de sentry-cli échoue et fait échouer le build (comportement voulu, pas de `ignoreExitValue`).
- Release d'envoi = `<applicationId>@<versionName>+<versionCode>` et dist = `versionCode`, identiques à ceux du SDK (`com.mikrolan.app@1.2.0+45`, dist 45). Ne pas définir `SENTRY_RELEASE`, qui casserait cette correspondance.
- `android/sentry.properties` (suivi) ne contient que l'URL, l'organisation et le projet ; le token vient de l'environnement. Ne pas activer `flavorAware` (le token serait alors passé en argument et journalisé).
- Pas de `metro.config.js` Sentry : pas de Debug ID injecté, la correspondance se fait par release + dist.
- Le token d'envoi n'est jamais embarqué dans l'APK.

## Volume attendu
Erreurs et crashs : tous. Traces : 5 % en production. Volume estimé faible ; à confirmer en staging.
