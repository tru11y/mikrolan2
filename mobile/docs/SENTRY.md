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
- **À vérifier sur le build de laboratoire** : contenu d'un crash natif (breadcrumbs natifs, interactions utilisateur) — le scrubber JS ne s'y applique pas.

## Nettoyage (`sentryScrub.ts`)
- Événement : message, exceptions, extra, contexts, tags nettoyés ; `user` vidé ; corps/cookies de requête supprimés ; URL réduite à la route.
- Route normalisée : chemin seul (ni hôte, ni query, ni fragment) ; seuls les segments en minuscules/tirets (20 car. max) sont gardés, tout le reste devient `:id` (UUID, CUID, ULID, ObjectId, codes de ticket ou de lot, nombres).
- Motifs masqués : Bearer, JWT, e-mail, téléphone, IPv4/IPv6, MAC, clé WireGuard, paramètres d'URL sensibles ; clés sensibles (password, token, code, cred, saspay, identifiants routeur/lot/ticket/plan/tenant…).
- Réduction à l'émission : `reportSilent` n'envoie que des nombres/booléens en `data` ; plus aucun identifiant ni nom.

## Sourcemaps
`android/app/build.gradle` applique `sentry.gradle` uniquement si `SENTRY_AUTH_TOKEN` est défini ; release = `<applicationId>@<versionName>+<versionCode>`, identique à celle du SDK. Sans token, rien n'est envoyé.

## Volume attendu
Erreurs et crashs : tous. Traces : 5 % en production. Volume estimé faible ; à confirmer en staging.
