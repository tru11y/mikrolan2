# Audit QA — MikroLan Mobile

**Portée** : `C:\dev\mikrolan2\mobile` (Expo SDK 54 / RN 0.81.5 / expo-router v6)
**Date** : 2026-08-13 · **Type** : test statique + exécution outillage (lecture seule, aucune modification)
**Limite** : aucun appareil/émulateur ni routeur MikroTik disponible → pas de test d'exécution ni de mesure de perf réelle. Le périmètre couvert est : build/typage, config native, flux d'auth, réseau/offline, concurrence, intégrité métier (tickets/argent), cycle de vie.

---

## Résultats outillage

| Contrôle | Résultat |
|---|---|
| `tsc --noEmit` | ✅ 0 erreur (TS strict) |
| `expo-doctor` (18 checks) | ⚠️ 15/18 — 3 échecs (voir C1, M3) |
| Tests unitaires / e2e | ❌ **aucun** — pas de jest, pas de detox, aucun fichier `*.test.*` |
| Lint | ⚠️ script `expo lint` déclaré mais aucune config ESLint dans le repo |
| `console.log` résiduels | ✅ 2 seulement, tous deux justifiés (diagnostic) |
| Secrets en dur | ✅ aucun (les client IDs Google dans `app.json` sont publics par nature) |

---

## Bugs critiques (bloquants)

### C1 — Les notifications push ne fonctionnent dans aucun build
`src/providers/push-notifications-provider.tsx:38-39`
```ts
const projectId = Constants.expoConfig?.extra?.eas?.projectId;
if (!projectId) return null;
```
`app.json` → `extra` ne contient que `googleWebClientId` / `googleAndroidClientId`. **Il n'y a ni `extra.eas.projectId` ni `eas.json` dans le repo.** `getExpoPushTokenAsync` n'est donc jamais appelé, aucun token n'est enregistré côté serveur, et tous les échecs sont avalés par `.catch(() => {})` (l.55-57) → **panne 100 % silencieuse**.

Second verrou indépendant : `android/app/src/main/AndroidManifest.xml` ne déclare **pas `POST_NOTIFICATIONS`**. Sur Android 13+ (la majorité du parc), même avec un token valide aucune notification ne s'affiche. Le manifeste est commité et `expo prebuild` n'est pas rejoué (confirmé par expo-doctor : *« properties will not be synced »*), donc le plugin `expo-notifications` ne peut pas corriger ça tout seul.

**Impact** : la fonctionnalité « le gérant est prévenu qu'un ticket vient d'être activé » — argument produit — est morte. Le toggle « notifications » de `(tabs)/account.tsx` ment à l'utilisateur.
**Correctif** : ajouter `extra.eas.projectId` + `eas.json`, ajouter `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>`, et **logger/afficher** l'échec d'enregistrement au lieu de le swallow.

### C2 — La vérification de ticket refuse des tickets légitimes
`app/verify-ticket.tsx:142-165` charge **toute** la liste des vouchers et cherche le code côté client.
Or `backend/src/modules/vouchers/voucher.service.ts:225-235` : `orderBy: createdAt desc`, **`take: 500`**.

Au-delà de 500 tickets émis sur un routeur, tout code plus ancien renvoie :
> « Ticket inconnu — Ce code n'a pas été émis pour ce routeur. Il peut être faux ou provenir d'un autre point de vente. »

**Impact** : le gérant refuse un client qui a payé, avec un message qui l'accuse de fraude. 500 tickets, c'est quelques semaines pour un cyber actif. C'est le pire type de faux négatif : silencieux, tardif, et il détruit la confiance dans la fonction.
**Correctif** : endpoint serveur `GET /routers/:id/vouchers/lookup?code=` (recherche indexée, réponse unitaire). Au passage, ça supprime le téléchargement de 500 objets pour lire un code.

### C3 — Génération de tickets en mode LAN : perte d'argent sur échec partiel
`app/generate-vouchers.tsx:116-141` + `src/services/mikrotik-lan/hotspotLan.ts:41-54`

Séquence : `generateVouchers` (serveur crée le lot) → `pushVouchersLan` (boucle `for`, un `add` par ticket sur le socket TCP) → `confirmVouchers`.

Si la boucle échoue au ticket *n* (routeur qui se déconnecte, timeout de 8 s sur un `add`) :
- les *n-1* utilisateurs hotspot **existent physiquement sur le routeur** et sont utilisables ;
- `pushVouchersLan` lève, la variable locale `out` (les *n-1* ids) est **perdue** ;
- `confirmVouchers` n'est jamais appelé → le lot reste non confirmé côté serveur ;
- le `catch` (l.137) se contente d'un toast d'erreur : **aucune reprise, aucun rollback, aucune trace**.

**Impact** : des codes vendables circulent sans exister dans la compta, ne remontent pas dans le CA, et une révocation ultérieure ne les atteindra pas. Sur un lot de 100 tickets à 8 s de timeout unitaire, la fenêtre d'échec est large.
**Correctif** : sortir `out` du scope (accumulateur passé en paramètre ou `try/finally`), confirmer **ce qui a réussi** même en cas d'échec, et proposer une reprise du lot.

---

## Bugs majeurs

### M1 — Désynchronisation requête/réponse du client RouterOS après un timeout
`src/services/mikrotik-lan/MikroTikApiClient.ts:249-271`

`talk()` n'a qu'un seul emplacement `this.pending`. Sur timeout, `failPending()` rejette et met `pending = null` **sans fermer le socket**. La réponse tardive du routeur arrive ensuite et est silencieusement jetée (`if (!p) continue`, l.222) — mais si un `talk()` suivant a démarré entre-temps, **il reçoit la réponse de la commande précédente**.

Conséquence concrète : un `print` lent suivi d'un `add` peut faire croire à un succès avec les mauvaises données. Dans un flux de provisioning (`pushWireGuard.ts`, `hotspotLan.ts`) c'est une écriture réseau sur mauvaise décision.

Aggravant : le champ `private queue: string[][]` (l.166) est **déclaré et jamais utilisé** — la sérialisation des commandes était prévue et n'a pas été implémentée. Aucun appel concurrent n'existe aujourd'hui (tous les `withApi` sont séquentiels — vérifié), donc c'est une bombe à retardement plutôt qu'un bug actif.
**Correctif** : `destroy()` le socket sur timeout (une session `withApi` est jetable de toute façon), et/ou implémenter la file.

### M2 — Aucune stratégie hors ligne, alors que c'est un pré-requis produit
`src/providers/query-provider.tsx` : `retry: 1`, `staleTime: 15s`, pas de `networkMode`, **pas de persistance de cache**, pas de `NetInfo`, pas de wiring `focusManager`/`onlineManager` sur `AppState`.

- Démarrage à froid sans réseau → l'app est vide (aucun cache disque). Pour un gérant en zone à connectivité intermittente c'est bloquant.
- `refetchOnWindowFocus: false` sans `focusManager` RN → au retour d'arrière-plan les données affichées peuvent être arbitrairement anciennes, sans indicateur.
- Le CLAUDE.md du projet exige explicitement « Offline-first : gérer les états de réseau explicitement ».

À porter au crédit : `(tabs)/index.tsx:211-224` distingue proprement `loading / error-sans-donnée / error-avec-cache / vrai zéro`. Le pattern est bon — il n'est juste pas généralisé ni adossé à un cache persistant.

### M3 — Le mode LOCAL (gratuit) est inopérant sur iOS
`src/lib/lanBinder.ts:18` : `if (Platform.OS !== 'android' || !native) return null;`

`getWifiInfo()` retourne toujours `null` sur iOS → la sonde locale de `(tabs)/index.tsx:164-189` s'arrête immédiatement, les routeurs LOCAL restent en `UNKNOWN`, et le mode gratuit (le seul avant paiement) ne marche pas. Aucun message n'explique pourquoi.

Par ailleurs `react-native-tcp-socket` est signalé **« Untested on New Architecture »** par expo-doctor alors que `newArchEnabled: true` — et un commentaire du code (`lanBinder.ts:26-30`) documente déjà un **hard-crash natif** (« No socket with id 0 ») avec cette lib. C'est la dépendance la plus risquée du projet, sur le chemin critique.

### M4 — Un crash d'écran fait tomber toute l'application
`ErrorBoundary` n'est monté **qu'une fois, à la racine** (`app/_layout.tsx:17`). Le CLAUDE.md exige « Error boundaries sur chaque écran ».

Deux conséquences :
1. n'importe quelle exception de rendu dans un écran remplace l'app entière par l'écran d'erreur — l'utilisateur perd sa navigation ;
2. le bouton « Réessayer » (`ErrorBoundary.tsx:18`) ne fait que `setState({ error: null })` : il **remonte le même arbre au même endroit**, donc si la cause est déterministe (donnée serveur malformée) l'écran re-crashe aussitôt → boucle. Il faudrait renvoyer vers l'accueil.

De plus le message affiché est `error.message` brut en police mono — technique, en anglais la plupart du temps, incohérent avec `describeError()` utilisé partout ailleurs.

### M5 — Rafraîchissement local : intervalle réarmé en boucle, sonde potentiellement jamais déclenchée
`app/(tabs)/index.tsx:141-197`

`probeLocalRouter` dépend de `list = routers.data ?? []`. La query `routers` a `refetchInterval: 15_000` → nouvelle identité de tableau toutes les 15 s → `probeLocalRouter` change → `useFocusEffect` nettoie et **réarme** le `setInterval(…, 15_000)`.

L'intervalle de sonde et l'intervalle de refetch étant tous deux à 15 000 ms, le timer est réarmé à peu près au moment où il devrait tirer : la sonde périodique ne s'exécute de façon fiable que via le `void probeLocalRouter()` d'ouverture. Le comportement est une course, donc non déterministe selon la latence réseau. (Le `?? []` crée en plus une identité neuve à chaque rendu quand `data` est `undefined`.)
**Correctif** : `useRef` sur la liste, ou dépendre de `routers.dataUpdatedAt` / d'une clé stable des ids.

---

## Bugs mineurs / durcissement

| # | Fichier | Constat |
|---|---|---|
| m1 | `src/providers/auth-provider.tsx:158-168` | `logout()` appelle `clearAllLocalRouterCredentials()` → `api.routers.list()` **avant** de purger. Hors ligne : 15 s de blocage puis les identifiants RouterOS **restent sur l'appareil** (le `catch` est best-effort). Purger localement par préfixe de clé, sans dépendre du réseau. |
| m2 | `src/providers/app-lock-provider.tsx` | Le verrou biométrique ne s'arme qu'après **2 min** en arrière-plan et n'est **jamais** appliqué au démarrage à froid. Surtout : rien ne masque le contenu dans l'aperçu multitâche (pas de `FLAG_SECURE`), donc le CA du jour reste lisible sans authentification. |
| m3 | `src/providers/app-lock-provider.tsx:110-122` | Si l'utilisateur annule le prompt biométrique, `locked` reste `true` et l'effet ne se redéclenche pas — seul le bouton « Déverrouiller » sauve la session. Pas d'échappatoire (mot de passe) si la biométrie échoue durablement. |
| m4 | `src/lib/api.ts:503-526` | Refresh 401 : si `refreshTokens()` échoue **et** que la 1re requête reste en vol, `refreshInFlight` est remis à `null` par le premier awaiter → une requête arrivant juste après relance un refresh complet. Dedup imparfaite (impact faible : `refreshTokens` purge les jetons en cas d'échec). |
| m5 | `src/lib/api.ts:364, 389-395` | `normalizeApiBaseUrl` s'appuie sur `new URL()` **au chargement du module** et écrit `parsed.pathname/search/hash`. Le polyfill `URL` de React Native est notoirement partiel ; toute régression ici est un crash au démarrage, avant tout écran. À sécuriser par un parsing regex ou `react-native-url-polyfill`. |
| m6 | `src/lib/sse.ts:120-126` | Le flux lit `request.responseText`, qui **grandit indéfiniment** tant que la connexion tient (`consumed` n'est qu'un curseur). Sur une session longue au premier plan, la chaîne accumule tout l'historique en mémoire. Prévoir une reconnexion volontaire périodique (p. ex. toutes les 30 min). |
| m7 | `src/providers/live-events-provider.tsx:210-216` | `closeAll()` sur tout état ≠ `active` : sur iOS, `inactive` est transitoire (centre de contrôle, appel entrant) → cycle fermeture/reconnexion inutile. Ne fermer que sur `background`. |
| m8 | `src/providers/live-events-provider.tsx:229-256` | Le `Set` `seen` du sondage de secours croît sans borne pour toute la durée de la session. `degraded` ne repasse à `false` qu'à une réouverture SSE réussie → sondage 15 s indéfini derrière un proxy hostile (batterie). |
| m9 | `src/lib/lanBinder.ts:31-33` | `sameSubnet24` code en dur un masque /24. Un LAN en /16 ou /23 (fréquent sur du MikroTik configuré à la main) est déclaré « hors LAN » → mode local indisponible sans explication. Le `netmask` est pourtant déjà retourné par `getWifiInfo()`. |
| m10 | `src/lib/lanBinder.ts:40-56` | `withWifi()` n'est **appelé nulle part** — code mort depuis que le pinning est passé par socket (`interface: 'wifi'`). |
| m11 | `app/verify-ticket.tsx:124` | `routerId` vient de `useLocalSearchParams` sans aucune garde : en accès direct/deep-link sans paramètre, l'appel part avec `undefined` dans l'URL. |
| m12 | `app.json:6,19` | `version: "0.1.0"` figé alors que `versionCode: 29`. 29 builds partagent le même nom de version : impossible pour un utilisateur ou le support d'identifier la build installée. |
| m13 | `AndroidManifest.xml:6,10` | `READ/WRITE_EXTERNAL_STORAGE` demandés. Inutiles avec `expo-print` + `expo-sharing` sur Android 10+ (scoped storage) ; permissions sensibles qui alourdissent la revue Play Store. |
| m14 | `AndroidManifest.xml:18` | `android:allowBackup="true"`. Des règles `secure_store_backup_rules` existent — vérifier qu'elles excluent bien SecureStore, sinon les jetons partent dans le backup cloud. |
| m15 | `network_security_config.xml` | Cleartext autorisé uniquement pour `10.0.2.2` et `localhost` (émulateur). Correct pour l'API RouterOS (TCP brut, non concerné), mais toute future API REST RouterOS en `http://192.168.x.x` sera bloquée en release. |
| m16 | `src/providers/push-notifications-provider.tsx:10-16` | `shouldShowAlert` est déprécié depuis SDK 53 (remplacé par `shouldShowBanner`/`shouldShowList`, déjà présents) — à nettoyer. |
| m17 | projet | `expo lint` déclaré sans configuration ESLint ; **aucun test automatisé**. Une régression sur C2/C3 ne serait détectée par aucun garde-fou. |

---

## Ce qui est solide

Pour être juste, le code tient sur plusieurs points qu'on trouve rarement à ce stade :

- **TS strict à 0 erreur** sur ~11 000 lignes, sans `any` échappatoire visible.
- **Les erreurs sont traduites** systématiquement (`describeError`/`extractErrorMessage`), jamais de message technique brut affiché (sauf `ErrorBoundary`, cf. M4).
- **P0-2 de l'audit UI précédent est corrigé** : `(tabs)/index.tsx:211-224` distingue désormais explicitement erreur réseau et vrai zéro — le faux « 0 FCFA » n'existe plus.
- **Le client SSE est bien conçu** : reprise par `lastEventId`, backoff exponentiel plafonné, repli par sondage, et le choix de `addEventListener` plutôt que `onreadystatechange` est documenté avec la raison exacte (livraison incrémentale RN). Rare.
- **Décisions de sécurité assumées et écrites** : plaintext RouterOS limité au LAN, identifiants dans l'enclave, `PaywallLock` présenté comme un simple miroir du serveur.
- **Commentaires de haute valeur** : plusieurs expliquent le bug historique évité (`.proplist` obligatoire sinon stall, `handleEventRef` sinon OkHttp annule à 2 ms). C'est de la doc qui empêche des régressions.

---

## Priorisation

| Ordre | Item | Effort | Risque si non traité |
|---|---|---|---|
| 1 | **C1** push mortes | faible (config) | fonctionnalité annoncée inexistante |
| 2 | **C2** vérif. ticket faux négatif | moyen (endpoint) | clients payants refusés |
| 3 | **C3** perte de lot en LAN | moyen | argent non compté, codes fantômes |
| 4 | **M1** désync RouterOS | faible (`destroy()`) | écriture réseau sur mauvaise donnée |
| 5 | **M4** ErrorBoundary | faible | app entière tombe + boucle de crash |
| 6 | **M2** offline | élevé | inutilisable en connectivité faible |
| 7 | **M3** iOS / New Arch | élevé | pas de mode gratuit sur iOS |
| 8 | m1, m2, m14 (fuites secrets/jetons) | faible | exposition d'identifiants |

**Recommandation transverse** : avant toute nouvelle fonctionnalité, mettre en place un socle de tests (jest + `@testing-library/react-native`) et couvrir en priorité `verify-ticket`, le flux de génération LAN, et `MikroTikApiClient` (encodage/décodage du protocole, qui se teste sans routeur). C1, C2 et C3 auraient tous été attrapés par un test.
