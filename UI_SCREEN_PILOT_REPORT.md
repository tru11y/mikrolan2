# Rapport — Écran pilote « Routeurs » (Phase A + B)

**Portée** : `mobile/src/components/ui.tsx` (fondations) + `mobile/app/(tabs)/routeurs.tsx` (écran pilote).
**Date** : 2026-08-07.
**Suite de** : `UI_UX_AUDIT.md`.

---

## 1. Résumé des modifications

Phase A (`ui.tsx`) : ajout de tokens de graisse (`weight`), d'une échelle d'élévation (`elevation`), d'un helper `withAlpha()`, d'une couleur `theme.onStrong`, d'un prop `accessibilityHint` sur `Press`, et de quatre commentaires de convention (couleur sémantique — déjà présent, iconographie, élévation, `Card` vs `View`). Aucune signature existante modifiée, aucun style partagé retouché.

Phase B (`routeurs.tsx`) : migration complète vers les tokens du design system, remplacement des `Pressable` bruts par `Press` (retour tactile), remplacement de la boîte d'icône manuelle par `IconChip`, correction de la couleur « en ligne » (violet → vert), passage du badge « LOCAL » de violet à gris neutre, ajout d'un état de chargement (`SkeletonCard` ×3), d'un état d'erreur bloquant (`ErrorState` + retry) distinct du cas « erreur avec liste en cache » (`Banner`, liste conservée), ajout d'une action « Ajouter un routeur » sur l'état vide, repositionnement du FAB sur `useBottomNavHeight()` au lieu d'un magic number, `accessibilityLabel`/`accessibilityHint` sur les cartes et le FAB.

Aucune fonctionnalité métier changée : mêmes données, mêmes requêtes, même navigation, même pull-to-refresh.

---

## 2. Fichiers modifiés

- `mobile/src/components/ui.tsx`
- `mobile/app/(tabs)/routeurs.tsx`

## Fichiers créés

- `UI_SCREEN_PILOT_REPORT.md` (ce document)

Aucun autre fichier touché (vérifié par `git diff --stat`).

---

## 3. Tokens ajoutés

| Token | Valeur | Usage prévu |
|---|---|---|
| `weight.regular/medium/semibold/bold/heavy` | `'400'…'800'` | Graisses de texte cohérentes (`weight.bold` utilisé sur le nom du routeur) |
| `elevation.none/subtle/floating` | objets `ViewStyle` (iOS shadow* + Android elevation) | `elevation.floating` appliqué au FAB (reproduit exactement l'ombre violette d'origine, désormais centralisée) |
| `withAlpha(hex, opacity)` | fonction | Remplace la concaténation manuelle `couleur + '22'`. **Non utilisé dans `routeurs.tsx`** (le seul site d'alpha de l'écran, la boîte d'icône, a été remplacé par `IconChip` qui gère déjà son alpha en interne — je n'ai pas touché à l'implémentation interne d'`IconChip` pour ne pas faire dériver son rendu sur tous les écrans qui l'utilisent). Disponible pour la Phase E/F sur les ~40 sites d'alpha manuel relevés par l'audit. |
| `theme.onStrong` | `#FFFFFF` | Blanc centralisé pour contenu sur couleur forte. **Non utilisé dans `routeurs.tsx`** (l'écran n'a ni `Switch` ni badge blanc) ; posé pour la Phase F (`thumbColor` des `Switch`, badges `NotificationBell`/`admin.tsx`). |
| `Press({ accessibilityHint })` | nouveau prop optionnel | Utilisé sur les cartes routeur et le FAB |

`weight` et `elevation` sont réellement consommés par l'écran pilote ; `withAlpha` et `theme.onStrong` sont posés comme fondations mais volontairement pas forcés dans cet écran faute d'un site d'usage légitime — les utiliser artificiellement aurait ajouté de la décoration non demandée.

---

## 4. Structure visuelle retenue

1. `AppHeader` (« Routeurs ») — inchangé.
2. Résumé compact du parc : deux points de statut + compteur (« N en ligne » / « N hors ligne »), texte seul, aucune carte décorative.
3. Liste des routeurs (`FlatList`) : une carte par routeur — icône, nom, identité (mono), modèle optionnel, badge de statut, badge de mode (LOCAL/À DISTANCE, visible seulement en non-PRO).
4. FAB « Ajouter un routeur », violet, ancré au-dessus de la barre de navigation.

Pas de carte hero, pas de dégradé, pas de métrique inventée.

---

## 5. Comportements fonctionnels préservés

Recensés avant modification (Étape 1) puis revérifiés après :

| Comportement | Avant | Après |
|---|---|---|
| Récupération des données | `useQuery(['routers'], api.routers.list, refetchInterval 3s, keepPreviousData)` | Identique |
| Chargement | pas de traitement dédié (liste vide affichée le temps du 1er fetch) | `SkeletonCard` ×3 tant que `query.isLoading` |
| Erreur | `Banner` toujours affiché en tête de liste, y compris quand la liste est vide (se lisait comme une liste vide + une bannière) | `ErrorState` + Réessayer si aucune donnée en cache ; `Banner` + liste conservée si des données sont déjà là |
| Refresh | `RefreshControl` sur `query.isRefetching`/`query.refetch` | Identique |
| Ouverture d'un routeur | `Link` → `/router/[id]` | Identique (le `Pressable` interne devient `Press`) |
| Ajout d'un routeur | FAB → `router.push('/add-router')` | Identique, position recalculée via `useBottomNavHeight()` au lieu de `76 + insets.bottom` |
| État vide | `Empty` avec texte seul | `Empty` avec texte + action « Ajouter un routeur » |
| Navigation | `useRouter`, `Link` | Identique |
| Safe area | `useSafeAreaInsets()` pour le FAB | Remplacé par `useBottomNavHeight()` (qui intègre déjà `insets.bottom`) — voir §13 risques |
| Hauteur BottomNav | `useBottomNavHeight()` pour le padding de liste | Identique, plus aussi utilisé pour le FAB |

---

## 6. États loading, empty, error, offline et refresh

- **Loading** : `SkeletonCard` ×3 remplace l'ancien comportement (aucune structure visible avant le premier résultat).
- **Empty** : `Empty` avec action de récupération identique à celle du FAB — cohérent, un utilisateur sans routeur n'est jamais bloqué.
- **Error (sans cache)** : `ErrorState` plein écran avec bouton Réessayer relié à `query.refetch()`.
- **Error (avec cache)** : la liste reste utilisable, `Banner` rouge non bloquant en tête — jamais transformée en état vide.
- **Refresh** : `RefreshControl` natif inchangé ; ne coexiste jamais avec l'état skeleton (mutuellement exclusifs par construction : `isLoading` n'est vrai que sans donnée en cache).
- **Offline (un routeur donné, pas l'écran)** : carte à `opacity: 0.65` inchangée, badge de statut inchangé (`routerHealth`, voir §13 pour la couleur `warning`/or de ce badge, non touchée).

---

## 7. Accessibilité

- Cartes routeur : `accessibilityLabel` composite (« Nom, En ligne, Local »), `accessibilityHint` (« Ouvre le tableau de bord de ce routeur »), `accessibilityRole="button"` via `Press`.
- FAB : `accessibilityLabel="Ajouter un routeur"` (déjà présent), `accessibilityHint` ajouté.
- État pressed désormais visible (assombrissement + scale léger 0.97 via `Press`) — auparavant aucun retour tactile visuel.
- `useReduceMotion()` respecté automatiquement par `Press`/`SkeletonCard`/`Empty`/`ErrorState` (primitives du design system, inchangées).
- Cible tactile du FAB inchangée (56×56, au-dessus du minimum recommandé).
- Contraste `theme.textMuted` sur `theme.surface` : **non vérifié avec un outil** (même lacune que relevée dans l'audit, §15) — reste à faire avant la Phase H.

---

## 8. Performance

- `keyExtractor` stable (`r.id`), inchangé.
- `renderItem` toujours `useCallback`, mais dépendances corrigées : `[isPro]` au lieu de `[]`. **Le tableau de dépendances vide d'origine était incorrect** — `isPro` était lu dans la closure sans être déclaré comme dépendance, ce qui pouvait figer le badge de mode sur sa valeur au premier rendu si `isPro` changeait après coup (ex. juste après le chargement de la session). Correction de mémoïsation pure, aucun changement de comportement observable une fois `isPro` stabilisé — traité comme une correction de justesse du memoization, pas un changement de fonctionnalité.
- Aucun nouvel appel réseau, aucun refetch ajouté.
- Pas de `ScrollView` imbriqué autour du `FlatList`.
- Pas d'animation permanente par carte (le `Press` n'anime qu'au press).

---

## 9. Tests exécutés avec résultats exacts

| Vérification | Commande | Résultat |
|---|---|---|
| TypeScript | `npx tsc --noEmit` (dans `mobile/`) | **PASS** — 0 erreur (revérifié après le fix `zIndex` du §15, toujours PASS) |
| Lint | `npm run lint` (`expo lint`) | **NON DISPONIBLE** — voir incident ci-dessous |
| Tests | — | **NON DISPONIBLES** — aucun script de test dans `package.json` |

### Incident lint (résolu)

La première exécution de `npm run lint` a déclenché l'auto-configuration d'ESLint par `expo lint` (absent du projet, conforme à la mémoire déjà connue « npm run lint cassé »), qui a **installé silencieusement** `eslint` et `eslint-config-expo` dans `mobile/package.json` (devDependencies) et créé `mobile/eslint.config.js`, en violation directe de la contrainte « n'installe aucune dépendance ». Correction immédiate :
- `git checkout -- mobile/package.json` (retour à l'état d'origine, vérifié par `git diff` = vide).
- Suppression de `mobile/eslint.config.js`.

`node_modules/` contient désormais physiquement `eslint`/`eslint-config-expo` (188 paquets) car l'installation a déjà eu lieu sur le disque, mais **rien de tracké par git n'a changé** — `package.json`/`package-lock.json` sont identiques à l'état de départ. Un `npm install` propre resynchroniserait `node_modules` sur le lockfile réel et purgerait ces paquets. Le lint reste donc non exécutable sans réintroduire cette installation ; je ne l'ai pas retenté.

---

## 10. Captures produites ou raison de leur absence

**Mise à jour (voir §15) : des captures réelles ont depuis été produites**, sur appareil physique (Samsung Galaxy A56), après un rebuild debug qui a permis de faire tourner ce code exact. Au moment de la rédaction initiale de cette section, aucun rendu n'était encore accessible — l'historique est conservé ci-dessus par transparence, mais **la validation visuelle réelle a bien eu lieu** dans une phase ultérieure. Voir §15 pour la liste complète des captures et leurs chemins.

---

## 11. Contraintes restant à vérifier manuellement

Mis à jour après la validation réelle du §15 — certains points initialement listés ici sont désormais vérifiés, d'autres restent ouverts :

- ~~Alignement visuel du `Dot` « hors ligne » (rouge → gris neutre)~~ — **vérifié** : confirmé gris neutre sur capture réelle, lisible, pas de perte de signal perçue dans le contexte testé.
- ~~Contraste `theme.textMuted`~~ — **vérifié** : calculé (§15) et confirmé lisible à l'œil sur captures réelles.
- ~~Comportement d'`ErrorState`/Banner sur un vrai échec réseau~~ — **vérifié** : déclenché organiquement par une vraie coupure du routeur de production, comportement conforme (liste conservée, jamais vidée).
- Rendu sur petit écran Android (<360dp), iPhone/iOS — **toujours non testé** (device testé fait ~384dp de large ; pas d'environnement iOS sur Windows).
- Comportement à taille de police système agrandie (150–200 %) — **toujours non testé** (aucun réglage système modifié sur l'appareil de l'utilisateur sans accord).
- `accessibilityHint` répercuté par un lecteur d'écran réel (TalkBack) — **partiellement vérifié** : `accessibilityLabel` confirmé propagé jusqu'au natif (`content-desc`) via `uiautomator`, mais aucun test avec TalkBack activé.
- État pressed visuel de `Press`, loading skeleton, empty state, cartes multiples/noms longs — non capturés (transitoires ou non reproductibles avec les données réelles disponibles pendant la session).

---

## 12. Diff résumé

```
mobile/app/(tabs)/routeurs.tsx | 224 +++++++++++++++++++++++------------------
mobile/src/components/ui.tsx   |  81 +++++++++++++++
2 files changed, 208 insertions(+), 97 deletions(-)
```

(Chiffres mis à jour après l'ajout du `zIndex` du §15 ; +7 lignes/-0 par rapport à la version précédente du rapport.)

Aucun autre fichier du dépôt modifié par cette phase (vérifié : les modifications préexistantes et non liées sur `backend/`, `mobile/app/ip-bindings.tsx`, `mobile/app/plans.tsx`, `mobile/app/sessions.tsx`, `mobile/app/router-settings.tsx`, `mobile/src/lib/api.ts`, `mobile/src/services/mikrotik-lan/**` et `mobile/android/app/src/main/AndroidManifest.xml` — déjà présentes ou apparues via une session parallèle sur la branche `feat/mobile-onyx-aurora`, voir §15 — n'ont pas été touchées ni écrasées).

---

## 13. Risques résiduels

- **`routerHealth()` (dans `ui.tsx`) mappe `OFFLINE` sur le ton `warning` (or/ambre)**, alors que la règle de palette réserve l'or à l'argent/PRO. C'est une violation du même type que celles corrigées par l'audit (P0-1), mais elle vit dans une fonction **partagée par plusieurs écrans** (`AppHeader`, `router/[id].tsx`, badges de statut). La corriger aurait changé l'apparence d'écrans hors périmètre sans autorisation explicite — je ne l'ai **pas modifiée**, conformément à la consigne « éviter tout changement susceptible de modifier les autres écrans ». À traiter explicitement en Phase D/E avec un go/no-go dédié, car c'est probablement la correction sémantique la plus importante qui reste.
- ~~`Press` sous `Link asChild`~~ — **vérifié réel (§15)** : `accessibilityLabel` correctement propagé jusqu'au natif, tap réel confirmé navigant vers `/router/[id]`. Risque levé.
- ~~FAB repositionné via `useBottomNavHeight()`~~ — **bug réel trouvé (§15)** : le FAB était totalement non-interactif (absent de l'arbre d'accessibilité, aucun tap ne passait), cause probable `elevation` vs priorité tactile Android. Corrigé par `zIndex: 10`, revérifié fonctionnel sur device. Ce risque était donc réel et plus grave que prévu — heureusement capturé avant propagation aux autres écrans (voir §14, tout futur FAB doit inclure un `zIndex` explicite).
- ~~Dot « hors ligne » passé de rouge à gris neutre~~ — **vérifié réel (§15)** : confirmé gris neutre sur capture, lisible, pas de perte de signal apparente dans le contexte testé (un seul routeur, coupure réelle observée).
- **`routerHealth()` (dans `ui.tsx`) mappe `OFFLINE` sur le ton `warning` (or/ambre)**, alors que la règle de palette réserve l'or à l'argent/PRO. C'est une violation du même type que celles corrigées par l'audit (P0-1), mais elle vit dans une fonction **partagée par plusieurs écrans** (`AppHeader`, `router/[id].tsx`, badges de statut). La corriger aurait changé l'apparence d'écrans hors périmètre sans autorisation explicite — je ne l'ai **pas modifiée**. **Confirmé visuellement réel** : le badge « HORS LIGNE » s'affiche bien en or sur device (§15). À traiter explicitement en Phase D/E avec un go/no-go dédié, c'est probablement la correction sémantique la plus importante qui reste.
- **Lint non exécutable sans réinstaller des dépendances** — aucune vérification de style automatisée n'a couvert ce changement au-delà de TypeScript.
- **Points jamais observés** : loading skeleton, empty state, cartes multiples/noms longs, opacité d'une carte hors ligne prolongée, état pressed visuel, petit écran <360dp, texte agrandi, TalkBack, iOS — voir liste complète §15.

---

## 14. Recommandations pour le prochain écran

1. Trancher `routerHealth()` OFFLINE → `warning` avant de propager le design system plus loin : chaque écran qui l'utilise déjà (badges de statut) affiche actuellement de l'or pour « hors ligne », ce qui contredit la règle documentée dans `ui.tsx` lui-même.
2. Adopter `withAlpha()` sur les ~40 sites d'alpha manuel relevés par l'audit lors de la migration des écrans P0/P1 — pas fait ici faute d'un site d'usage légitime dans `routeurs.tsx`.
3. Centraliser `thumbColor="#fff"` des `Switch` sur `theme.onStrong` dès le premier écran qui en contient (`account.tsx` ou `ticket-settings.tsx`).
4. Réutiliser le triptyque loading/error-bloquant/error-avec-cache introduit ici (`SkeletonCard` / `ErrorState` / `Banner` + liste conservée) comme gabarit standard partout où une liste React Query n'a pas encore d'état d'erreur (corrige directement P0-2 de l'audit sur `(tabs)/index.tsx` et `(tabs)/tickets.tsx`).
5. ~~Obtenir un accès à un environnement de rendu~~ — **fait (§15)** : device réel utilisé, à reconduire pour les prochaines phases (voir procédure §15 : `expo run:android` avec `JAVA_HOME` forcé sur JDK 17, `adb reverse tcp:8081 tcp:8081`).
6. **Tout élément flottant en position absolue (FAB, badge superposé, etc.) doit désormais recevoir un `zIndex` explicite**, pas seulement `elevation` — leçon tirée du bug réel trouvé sur ce FAB (§15) : `elevation` seul ne garantit pas la priorité tactile sur Android face à un sibling déclaré après lui dans le JSX.
7. Auditer les autres FAB/éléments flottants déjà existants dans l'app (`add-router.tsx` en modal, tout autre écran avec bouton flottant) pour vérifier qu'ils ne souffrent pas du même défaut — ce bug était invisible en lecture de code et seul un test tactile réel l'a révélé.

---

## 15. Validation visuelle et interactive

**Résultat global : validation réelle obtenue.** Après plusieurs blocages (auth web impossible à automatiser, build device release trop ancien), un rebuild debug natif a été effectué avec l'accord explicite de l'utilisateur, connecté à Metro. **Mon code (Phase A/B) a tourné réellement sur l'appareil**, avec les données de production. Un vrai bug a été trouvé et corrigé pendant cette phase (FAB non cliquable — voir plus bas).

### Appareil et méthode de lancement

- Samsung Galaxy A56 (`SM-A566B`), Android 16, 1080×2340 px, densité 450dpi (~384dp de large), connecté en USB (adb).
- Web (`npx expo start --web`) : bundle compile mon code sans erreur, mais authentification impossible à automatiser (règle absolue : jamais de mot de passe saisi par mes soins) → abandonné pour l'écran cible.
- Build release déjà installé sur le device : non-debuggable, ne contenait pas mes changements → **insuffisant**.
- **Solution retenue (accord explicite utilisateur)** : `npx expo run:android` (script existant du projet) pour builder un **debug APK** contenant mon code, connecté au serveur Metro local.
  - Premier échec : Gradle cassait avec `Error resolving plugin [id: 'com.facebook.react.settings'] > 25.0.1` — cause connue en mémoire (`skills_gradle_jdk25_break`), JDK 25 par défaut au lieu de JDK 17. Corrigé en forçant `JAVA_HOME="C:\Program Files\Java\jdk-17"` pour la commande (aucun fichier modifié).
  - Build réussi en 16 min 41 s (246 tâches).
  - Installation échouée (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, signature debug ≠ release). **Désinstallation de l'app release confirmée explicitement par l'utilisateur** avant réinstallation du debug APK (perte de session locale, réauthentification nécessaire — effectuée par l'utilisateur lui-même sur son téléphone, je n'ai jamais touché au formulaire de connexion).
  - Metro relancé + `adb reverse tcp:8081 tcp:8081` pour connecter le debug client.
  - Après connexion réussie, **Fast Refresh a rechargé mon fix (zIndex) en direct** sans nouveau build.

### Comportement observé face aux contraintes d'accès

Deux tentatives de connexion en amont ont été correctement refusées de ma part conformément au mandat : je n'ai à aucun moment saisi ni tenté de saisir un mot de passe (web ou device), et j'ai attendu une confirmation explicite avant chaque action à fort impact (désinstallation de l'app, rebuild natif).

### Le compte utilisé est un tenant de production réelle

L'appareil est authentifié sur **FREEDOM HOME**, tenant de production avec tickets vendus (mémoire `feedback_freedom_home_live_tickets`). En conséquence, **aucune interaction mutante n'a été effectuée** : uniquement navigation (Quitter, tap carte, tap FAB, retour), aucune action sur un réglage, une suppression, une génération de tickets, un redémarrage routeur (un bouton rouge « Redémarrer le routeur » a été aperçu et volontairement évité). Toute donnée observée (1 routeur « FREEDOM HOME », statuts en ligne/hors ligne réels, fluctuant en direct) est réelle, non simulée.

**Fichiers hors périmètre modifiés par ailleurs pendant la session** (non touchés, probable session parallèle — voir mémoire `feedback_shared_workdir_collision`) : `mobile/app/router-settings.tsx`, `mobile/src/services/mikrotik-lan/pushWireGuard.ts`.

### États et interactions réellement testés

| Élément | Testé ? | Résultat |
|---|---|---|
| Écran Routeurs, **mon code refondu**, 1 routeur en ligne | ✅ Oui, sur device réel | Conforme : résumé discret, carte avec `IconChip`, badge vert, FAB |
| Point « en ligne » (fix violet→vert) | ✅ Oui | Confirmé vert par zoom pixel sur capture réelle |
| Point « hors ligne » (fix rouge→gris neutre) | ✅ Oui | Confirmé gris neutre par zoom pixel, déclenché organiquement par une vraie coupure réseau du routeur |
| Erreur avec cache (Banner + liste conservée) | ✅ Oui, déclenché organiquement | Fonctionne exactement comme conçu : « Serveur injoignable » affiché, carte toujours visible et lisible, jamais transformé en état vide |
| Badge « HORS LIGNE » en or (`routerHealth`, non modifié) | ✅ Oui | Confirmé — reste or comme documenté en risque résiduel §13 |
| `Link asChild` + `Press` (carte → détail routeur) | ✅ Oui | `content-desc="FREEDOM HOME, Hors ligne, À distance"` retrouvé tel quel dans l'arbre d'accessibilité natif (uiautomator) — `accessibilityLabel` correctement propagé ; tap réel confirmé navigant vers `/router/[id]` |
| FAB « Ajouter un routeur » | ⚠️ **Bug trouvé puis corrigé** | Voir section dédiée ci-dessous |
| Pull-to-refresh | Non testé isolément | Le rafraîchissement automatique (`refetchInterval` 3 s) a été observé fonctionner (statuts changeant en direct) |
| Loading (skeleton) | Non observé | Écran rechargé trop vite après connexion pour capturer l'état initial |
| Empty | Non testé | Le tenant a toujours eu ≥1 routeur pendant la session |
| Petit écran / texte agrandi | Non testé | Aucun réglage système modifié sur l'appareil de l'utilisateur sans accord explicite |
| iOS | Non testé | Pas d'environnement macOS/simulateur (Windows) |

### FAB — bug réel trouvé et corrigé

**Constat** : le FAB « Ajouter un routeur », bien que visuellement rendu (cercle violet en bas à droite), était **totalement non-interactif** : absent de l'arbre d'accessibilité natif (`uiautomator dump`, deux fois, dans deux états différents) et **aucun tap à ses coordonnées exactes** (centre mesuré par détection de couleur sur capture réelle) ne déclenchait la navigation vers `/add-router`.

**Cause probable** : sur Android, `elevation` (utilisé par `elevation.floating`) ne pilote que le rendu de l'ombre, pas la priorité de hit-test tactile entre siblings positionnés en absolu. `BottomNav`, déclaré après le FAB dans le JSX, obtenait la priorité tactile malgré l'absence de chevauchement visuel mesuré.

**Correction appliquée** : ajout de `zIndex: 10` sur le style du FAB dans `routeurs.tsx`, avec commentaire expliquant la cause (voir diff §12). C'est une correction d'accessibilité/interaction explicitement autorisée par le mandat de cette phase.

**Vérification** : après la correction (rechargée en direct par Fast Refresh, sans nouveau build), un tap au même endroit exact a **navigué avec succès** vers l'écran « Ajouter un routeur » (capture à l'appui). TypeScript revérifié PASS après le changement.

### Contraste (calculé, script Python temporaire, hors dépôt, supprimé après usage)

| Combinaison | Ratio | Texte normal (≥4.5) | Grand texte (≥3.0) | Usage réel dans `routeurs.tsx` |
|---|---|---|---|---|
| `theme.text` / `theme.bg` | 17.70 | PASS | PASS | Fond d'écran + textes principaux |
| `theme.text` / `theme.surface` | 16.35 | PASS | PASS | Nom du routeur sur la carte |
| `theme.textMuted` / `theme.bg` | 7.53 | PASS | PASS | — |
| `theme.textMuted` / `theme.surface` | 6.96 | PASS | PASS | Identité/modèle du routeur, résumé du parc |
| `theme.success` / `theme.surface` | 9.43 | PASS | PASS | Badge « En ligne » |
| `theme.warning` (gold) / `theme.surface` | 10.21 | PASS | PASS | Badge « Hors ligne » (via `routerHealth`, non modifié — voir §13) |
| `theme.onStrong` / `theme.primary` | 4.20 | **FAIL** | PASS | **Non utilisé dans cet écran** — à éviter pour du petit texte si adopté ailleurs (Phase D/E) |

Aucune correction de contraste n'était nécessaire dans `routeurs.tsx` : la seule combinaison en échec (`onStrong`/`primary` pour texte normal) n'y est pas utilisée. Le doute de l'audit sur `textMuted` (§15 de l'audit) est levé : il passe confortablement sur les deux fonds réellement utilisés, et se confirme lisible à l'œil sur les captures réelles.

### Corrections appliquées cette phase

**Une seule** : ajout de `zIndex: 10` au style du FAB dans `routeurs.tsx` (bug d'interaction réel trouvé et vérifié sur device, voir plus haut). Aucune autre correction — tout le reste du rendu observé était conforme.

### Captures produites

Dossier `C:\Users\PC\AppData\Local\Temp\mikrolan2-captures\` (non tracké par Git) :
- `phone-10-routeurs-NEW.png`, `phone-20-final-routeurs.png` — écran Routeurs **refondu**, 1 routeur en ligne, résumé + carte + FAB.
- `phone-13-error-clean.png`, `zoom-dots.png` — état erreur-avec-cache (Banner + liste conservée) + zoom confirmant les couleurs des points de statut.
- `phone-14-fab-retest.png` — tap sur le FAB avant correction (aucun effet, bug confirmé).
- `phone-16-fab-fixed.png` — tap sur le FAB après correction, navigation réussie vers « Ajouter un routeur ».
- `phone-21-card-tap.png` — tap sur la carte, navigation réussie vers le détail du routeur.
- Captures antérieures (`phone-current.png`, `phone-3-routeurs-clean.png`, etc.) — ancien build, conservées à titre de référence historique uniquement.

### Points non testés restants

Cartes multiples (le tenant n'a qu'1 routeur), noms/modèles longs, opacité réelle d'une carte hors ligne (aucun routeur hors ligne assez longtemps pour capturer proprement), état pressed visuel de `Press` (transition trop rapide pour capture adb), loading skeleton, empty state, petit écran <360dp, texte système agrandi, lecteur d'écran (TalkBack) en conditions réelles, iOS.

### Verdict final

**VALIDÉ AVEC RÉSERVES**

L'écran Routeurs refondu (Phase A/B) a été réellement rendu et manipulé sur un appareil physique avec des données de production. Hiérarchie visuelle, couleurs sémantiques (fix violet→vert et rouge→gris confirmés), badges, navigation par carte (`Link asChild` + `Press`) et accessibilité de la carte sont tous conformes. Un bug d'interaction réel (FAB non cliquable) a été trouvé et corrigé pendant cette phase, puis re-vérifié fonctionnel. Les réserves portent sur les points non testés listés ci-dessus (états loading/empty, densité multi-cartes, petit écran, texte agrandi, lecteur d'écran) — aucun d'eux n'a donné signe de problème, mais aucun n'a été observé non plus.
