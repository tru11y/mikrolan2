# Rapport — Propagation au Dashboard (Maison)

**Fichier modifié** : `mobile/app/(tabs)/index.tsx`
**Référence** : standard validé sur `mobile/app/(tabs)/routeurs.tsx` (Phase B, `UI_SCREEN_PILOT_REPORT.md`)
**Date** : 2026-08-07/08.

---

## 1. Analyse avant modification (Étape 1)

### État git au départ

Avant modification : seuls `mobile/app/(tabs)/routeurs.tsx` et `mobile/src/components/ui.tsx` (Phase A/B) apparaissaient modifiés, plus les deux rapports non trackés. Aucun changement non lié à écraser.

**Note de contexte** : entre la Phase B et cette phase, une session parallèle a mergé une branche (`feat/dynamic-service-ports`) dans `main`, et le dépôt est passé de `feat/mobile-onyx-aurora` à `main`. Mes modifications non commitées ont traversé ce changement de branche sans perte (vérifié par `git diff --stat`). Signalé par transparence, non lié à mon travail.

### Comportements recensés dans l'ancien `index.tsx` (à préserver)

| Élément | Détail |
|---|---|
| Queries | `me` (`['me']`), `routers` (`['routers']`, `refetchInterval: 15_000`), `metrics` (`['metrics','today']`) — toutes avec `placeholderData: keepPreviousData` |
| Données affichées | `tenant.name`, `revenueXof`, `ticketsGenerated`, `activeSessions`, `ticketsUsed`, liste des routeurs, `online` (compte local) |
| Valeurs par défaut | `?? 0` partout sur les champs `metrics` — **c'est le bug P0-2 de l'audit**, aucune query n'avait de branche `isError` |
| Chargement | seul `metrics.isLoading` était testé (juste pour l'ellipse `…` sur le revenu) ; aucun autre indicateur de chargement |
| Erreur | **aucune**, ni pour `routers` ni pour `metrics` |
| Actions | Profil → `/(tabs)/account` ; Activer (essai) → `/pro` ; bannière PRO → `/pro` ; 4 tuiles → `/(tabs)/routeurs`, `/(tabs)/rapport` (×2), `/(tabs)/tickets` ; Ajouter → `/add-router` ; carte routeur → `/router/${id}` ; « Aperçu rapide des Tickets » → `/(tabs)/tickets` (doublon exact de la tuile Tickets) |
| Redirection | `if (isReady && activeRouterId) return <Redirect href={...} />` — inconditionnelle, avant tout rendu |
| Mode routeur actif | Redirection immédiate vers `/router/[id]`, le dashboard « Maison » n'est jamais visible si un routeur est actif |
| PRO / essai | `entitlement.tier` (`useAuth()`) — bannière essai si `TRIAL`, bannière PRO si `!isPro` |
| Pull-to-refresh | **absent** à l'origine |
| Padding BottomNav | `useBottomNavHeight()` sur le `contentContainerStyle` du `ScrollView` |

Tous ces comportements sont préservés dans la nouvelle version, à l'exception de la fusion de la carte « Aperçu rapide des Tickets » (doublon exact de destination et de donnée avec la tuile Tickets — fusionné, la destination `/(tabs)/tickets` reste atteignable via la tuile).

---

## 2. Correction P0 — état réseau (Étape 2)

Chaque query a désormais un état explicite calculé une fois :

```
routersLoading / routersErrored (isError && !data) / routersStale (isError && data)
metricsLoading / metricsErrored (isError && !data) / metricsStale (isError && data)
```

- **A. Premier chargement** : `Skeleton` (revenu, tuiles) et deux `Skeleton` en forme de ligne routeur (section routeurs) — jamais de zéro affiché pendant le chargement.
- **B. Erreur sans cache** : revenu → bloc « Indisponible » tapable (relance `metrics.refetch()`) ; section routeurs → `ErrorState` compact avec Réessayer (`routers.refetch()`) ; tuiles → valeur `—` + sous-texte « Indisponible » en rouge.
- **C. Erreur avec cache** : un seul `Banner` non bloquant en haut de l'écran (« Certaines informations peuvent ne pas être à jour »), le dashboard reste entièrement visible et utilisable, le pull-to-refresh permet de relancer.
- **D. Erreur partielle** : chaque section dépend uniquement de **sa propre** query (`routersState` vs `metricsState`) — si `routers` échoue mais `metrics` réussit, le revenu s'affiche normalement pendant que la section routeurs affiche son erreur, et réciproquement.
- **E. Vrai zéro** : aucun cas spécial requis — un zéro provenant d'une réponse valide traverse simplement la branche « ready » sans distinction, donc s'affiche normalement.

---

## 3. Hiérarchie retenue (Étape 3)

1. `AppHeader`
2. Bannière de fraîcheur (si nécessaire) + Résumé (carte de bienvenue, épurée — la mention « Compte administrateur vérifié » non vérifiée a été retirée, remplacée par le nom réel du tenant, déjà disponible)
3. `AuroraCard` — revenu du jour (seul élément en dégradé de l'écran)
4. Section « Mes routeurs » — aperçu (3 routeurs max + lien « Voir tous » si plus), pas une copie de l'écran Routeurs
5. Rangée de 3 tuiles d'action (Clients, Tickets, Sessions) — la tuile "Routeurs" de l'ancienne grille 2×2 a été retirée : elle dupliquait exactement la section 4 juste au-dessus, désormais adjacente et donc redondance plus flagrante qu'avant
6. Bannière essai (si `TRIAL`) puis bannière PRO (si `!isPro`) — déplacées en bas, ne dominent plus l'écran opérationnel
7. `BottomNav`

---

## 4. Traitement financier (Étape 4)

- Montant en `type.hero`/`weight.heavy`, unité FCFA en retrait (`opacity: 0.8`, poids moindre) — inchangé de l'original.
- Un montant valide à 0 s'affiche normalement (« 0 FCFA »).
- Erreur réseau → jamais « 0 FCFA », toujours le bloc « Indisponible » dédié.
- Pas de vert sur le montant, pas de gradient supplémentaire (l'`AuroraCard` est déjà le seul dégradé de l'écran, inchangé).
- **Corrections de teinte** : l'icône de la tuile « Tickets » est passée de `theme.gold` à `theme.primary` — l'or est réservé à l'argent/PRO (règle explicite de cette phase), et un compte de tickets générés n'est pas lui-même un montant. Le `subTone="secondary"` (violet déprécié) de la tuile Sessions a été retiré du type local `StatState`/props ; Sessions utilise désormais `success` (état sain), plus cohérent que l'ancien violet décoratif sans signification.
- Calculs et sources de données strictement inchangés (`revenueXof`, `.toLocaleString('fr-FR')`).

---

## 5. État des routeurs (Étape 5)

- En ligne = vert (`RouterStatusDot` + libellé `routerHealth(...).label`), hors ligne = ce que `routerHealth()` retourne déjà (non modifié dans cette phase — reste or/ambre pour `OFFLINE`, risque déjà documenté en Phase B, non traité ici pour ne pas affecter d'autres écrans).
- Chaque ligne combine couleur (pastille) **et** texte (libellé) — jamais la couleur seule.
- Violet réservé à l'interaction (bouton « Ajouter », lien « Voir tous », icône de section).
- Aucun or sur un statut réseau dans cette section.
- Aperçu limité à 3 routeurs + lien vers la liste complète si plus — pas de duplication visuelle de l'écran Routeurs (style de ligne compact, distinct du style `Card` plein utilisé sur l'écran dédié).
- Nom du routeur dominant (`weight.bold`, `type.body`), infos secondaires limitées à une ligne (statut + modèle).
- Navigation exacte préservée (`/router/${r.id}`), migrée vers `Link asChild` + `Press` (pattern validé Phase B), avec `accessibilityLabel`/`accessibilityHint`.

---

## 6. Actions et navigation (Étape 6)

Toutes les destinations existantes vérifiées préservées : `/(tabs)/account`, `/pro` (×2), `/(tabs)/rapport` (×2), `/(tabs)/tickets`, `/add-router`, `/router/${id}`. Tous les `Pressable` bruts ont été migrés vers `Press` (retour tactile, `accessibilityLabel`/`accessibilityHint` cohérents). Le pattern `Link asChild` + `Press`, validé sur Android en Phase B pour les cartes routeur, est réutilisé à l'identique pour la section routeurs de ce dashboard.

---

## 7. Abonnement / essai (Étape 7)

Aucune règle d'entitlement, redirection `PaywallLock`, calcul de durée d'essai ou rôle utilisateur modifié — uniquement repositionnement visuel (fin d'écran au lieu du haut) et migration `Pressable` → `Press`/tokens `weight`. Logique `entitlement.tier`/`daysLeft` intacte.

---

## 8. Design system (Étape 8)

Tokens utilisés : `theme`, `type`, `weight`, `space`, `radius`, `icon`, `withAlpha`. **Aucune modification de `ui.tsx` dans cette phase** — tout ce qui était nécessaire (`weight`, `Press` avec `accessibilityHint`, `withAlpha`, `Skeleton`, `ErrorState`, `Empty`, `Banner`) existait déjà depuis la Phase A. `elevation.floating` n'est utilisé nulle part dans ce dashboard (pas de FAB, aucune carte flottante) — conforme à la consigne de ne pas l'appliquer à des cartes normales. `withAlpha` a un usage réel et légitime : le `Skeleton` du revenu, affiché sur le dégradé violet de l'`AuroraCard`, utilise `withAlpha(theme.onStrong, 0.25)` pour un bloc blanc translucide cohérent avec le fond — premier usage concret de ce helper dans le projet.

---

## 9. Accessibilité et responsive (Étape 9)

Vérifié dans le code : `numberOfLines={1}` sur les noms de routeur, tenant et libellés potentiellement longs ; `accessibilityLabel` composite sur chaque tuile (« Label, valeur, sous-texte » ou « Label, indisponible ») et chaque ligne routeur ; cibles tactiles via `Press` (padding généreux hérité du style existant, non réduit) ; contraste : mêmes combinaisons que la Phase B, déjà calculées et toutes PASS (`theme.text`/`theme.textMuted` sur `theme.bg`/`theme.surface`) — aucune nouvelle combinaison de couleur introduite qui n'ait pas déjà été validée.

**Non testé** (voir §11) : rendu réel sur l'appareil, texte système agrandi à 150 %, largeur Android réelle, ordre de lecture avec un lecteur d'écran. `allowFontScaling` non touché nulle part (aucun blocage ajouté).

---

## 10. Performance (Étape 10)

- Aucune query dupliquée, aucun `refetchInterval` ajouté ou modifié (`routers` reste à 15 s, `metrics` reste sans intervalle).
- `probeLocalRouter`, `useFocusEffect`, `healthOf` : **strictement inchangés**, aucune ligne touchée dans cette logique.
- Les nouveaux états dérivés (`routersLoading`, `metricsErrored`, etc.) sont de simples comparaisons booléennes calculées à chaque rendu — coût négligeable, pas de `useMemo` nécessaire.
- `refreshAll()` (pull-to-refresh) appelle `routers.refetch()` / `metrics.refetch()` / `me.refetch()` — trois refetch manuels déclenchés uniquement par le geste utilisateur, aucun intervalle nouveau.
- Aucune animation permanente ajoutée (les seules animations proviennent des primitives déjà existantes : `RouterStatusDot` qui clignote en ONLINE, `Press`, `Skeleton` — toutes préexistantes et déjà utilisées par cet écran ou l'écran pilote).
- Pas de liste imbriquée : la section routeurs reste un `.map()` simple dans un `ScrollView`, comme l'original.

---

## 11. Validation sur Samsung Galaxy A56 — **NON ABOUTIE**

**Tentatives réalisées** :
1. Relance de l'app debug (déjà installée depuis la Phase B) connectée au Metro existant → affichait l'**ancien** dashboard.
2. Metro tué et relancé avec `--clear` (cache vidé) + `adb reverse tcp:8081 tcp:8081` reconfiguré + `am force-stop`/`am start` (processus applicatif entièrement neuf) → **toujours l'ancien dashboard**, à l'identique (même grille 2×2, même texte « Compte administrateur vérifié », même intitulé « Mes routeurs connectés »).
3. Vérification que le fichier source sur disque contient bien le nouveau code (`grep` positif, horodatage récent) et que `git diff` reflète les 549 lignes attendues — confirmé, le code source est correct.
4. Vérification qu'aucun autre processus Metro ne tournait sur un port concurrent — confirmé, un seul process sur 8081.
5. `logcat` filtré sur le package : aucune trace de bundling ni d'erreur JS visible — l'app semble ne jamais avoir redemandé de bundle à ce Metro.

**Diagnostic probable** : un bundle JS mis en cache côté appareil (comportement de résilience hors-ligne du client React Native/Expo) est servi au démarrage sans repasser par le serveur de développement, malgré un processus applicatif neuf. La correction la plus fiable serait `adb shell pm clear com.mikrolan.app`, qui **efface toutes les données locales de l'app** (session, mais aussi les identifiants routeurs LAN enregistrés localement — pas seulement la session comme un uninstall/reinstall) — une action plus intrusive que celles déjà autorisées dans cette session, et l'heure tardive ne se prêtait plus à redemander une confirmation puis retester.

**Décision** : arrêt de la validation live à ce stade plutôt que de forcer une action à fort impact sur l'appareil sans confirmation explicite fraîche, ou que de prétendre avoir vu un rendu que je n'ai pas réellement observé.

### Ce qui a donc été vérifié / non vérifié

| Point | Statut |
|---|---|
| TypeScript | ✅ PASS |
| Cohérence du code avec le standard pilote (revue) | ✅ Fait (voir §1-10) |
| Ouverture réelle du nouveau dashboard | ❌ Non obtenue |
| Revenu, états des routeurs, tuiles en conditions réelles | ❌ Non observés (nouvelle version) |
| Navigation carte/tuile réelle sur le nouveau code | ❌ Non testée (nouvelle version) |
| Absence de crash/warning sur le nouveau code | ❌ Non vérifiable sans rendu réel |
| Aucune action destructive ni donnée modifiée | ✅ Confirmé — aucune interaction mutante effectuée sur le compte de production pendant cette phase (uniquement navigation) |

---

## 12. Captures

Dossier `C:\Users\PC\AppData\Local\Temp\mikrolan2-captures\` (non tracké) :
- `dash-06-new-dashboard.png`, `dash-07-new-dashboard.png`, `dash-08-fresh.png` — montrent l'**ancien** dashboard malgré les tentatives de rafraîchissement ; conservées comme preuve du blocage, pas comme validation.
- Aucune capture du nouveau dashboard n'a pu être produite — il n'y a rien à montrer tant que le bundle périmé n'est pas purgé.

---

## 13. Fichiers modifiés

- `mobile/app/(tabs)/index.tsx` (seul fichier touché cette phase)

`mobile/src/components/ui.tsx` **non modifié** — toutes les primitives nécessaires existaient déjà depuis la Phase A.

## 14. Dépendances ajoutées

Aucune.

## 15. Recommandations avant de rejouer la validation

*(Section obsolète — l'hypothèse « bundle en cache » du diagnostic précédent était incorrecte. Voir §23 pour la cause racine réelle, établie par preuve directe.)*

---

## 23. Diagnostic du bundle périmé — cause racine réelle

**L'hypothèse initiale (bundle mis en cache côté appareil) était fausse.** La cause racine, établie par preuve directe (logcat + `dumpsys package`), est :

**Le build installé sur l'appareil a été remplacé par un build release non-debuggable, par une installation externe survenue à 23:22:20, pendant que je travaillais sur le diagnostic.**

Preuve exacte (`adb logcat`, horodatage réel) :
```
23:22:18  PackageManager: START INSTALL PACKAGE: pkg{com.mikrolan.app}
23:22:18  PackageManager: Update package ... Retain data and using new
23:22:20  PackageManager: installation completed for package:com.mikrolan.app
23:22:20  PkgUpdateReceiver: Package still installed, this is an update not removal
```

`dumpsys package com.mikrolan.app` confirme l'état actuel :
```
flags=0x0                          ← PAS de flag DEBUGGABLE (mon build debug l'avait)
versionCode=29  versionName=0.1.0  ← identique au build release d'origine
lastUpdateTime=2026-08-07 23:22:20 ← 11 minutes après mon dernier test réussi (23:11)
installerPackageName=null          ← installé par sideload (adb install), pas Play Store
```

Un test non destructif (`adb install -r` de mon APK debug déjà buildé, sans désinstallation préalable) confirme le verrou :
```
Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.mikrolan.app
signatures do not match newer version; ignoring!]
```
→ Échec propre, **aucune donnée touchée**, l'app installée reste intacte. Signature de build release ≠ signature de build debug, comportement Android normal et attendu.

**Origine probable de la réinstallation externe** : je n'ai lancé aucune commande d'installation entre mon dernier test réussi (23:11) et la détection du problème. Le dépôt a une session parallèle active sur ce même poste (déjà documentée en Phase B — merge de `feat/dynamic-service-ports` dans `main` pendant mon propre travail). Il est très probable qu'un build/déploiement mobile de cette session parallèle ait réinstallé un APK release sur ce même appareil physique, sans lien avec mon code.

Recherche de code mort exclue comme cause alternative : `grep -rn "Compte administrateur vérifié\|Mes routeurs connectés"` dans `mobile/app` et `mobile/src` → **aucune occurrence**. Le texte affiché ne provient d'aucun fichier source actuel — uniquement du binaire release installé, qui a été compilé avant mes changements.

---

## 24. Metro réellement utilisé

| Élément | Valeur |
|---|---|
| PID | 25016 |
| Commande complète | `node "C:\dev\mikrolan2\mobile\node_modules\.bin\..\expo\bin\cli" start --clear` |
| Répertoire de travail | `C:\dev\mikrolan2\mobile` (confirmé exact — aucun autre dossier) |
| Port | 8081, seul processus dessus |
| Heure de démarrage | 2026-08-08 00:09:29 |
| Requête de bundle observée dans les logs | **Non, aucune** — confirme que l'app installée n'a jamais tenté de contacter ce Metro (cohérent avec un build non-debuggable, qui ne contient aucun code de connexion au packager) |

`index.tsx` sur disque : SHA-256 `130c2c9f5a4e0fe4740f146429b8d4c1a6cede962d6222e036601405d5418671`, modifié 2026-08-07 23:35:24, contient la chaîne unique « Certaines informations peuvent ne pas être à jour » (1 occurrence, vérifiée). Entrypoint Expo Router : `"main": "expo-router/entry"` (`package.json`), inchangé, normal.

---

## 25. Package Android réellement lancé

- Package au premier plan confirmé : `com.mikrolan.app/.MainActivity` (le bon package — pas de confusion possible).
- **Un second package sans rapport a été détecté** : `com.mikrolan` (sans `.app`), versionCode=1, versionName=1.0, installé le 2026-05-07 — projet ancien/différent, jamais au premier plan, sans impact sur ce diagnostic.
- Pas de suffixe `.debug` : le projet ne définit aucun `applicationIdSuffix` pour le build type debug dans `android/app/build.gradle` (vérifié) — debug et release partagent le même identifiant de package, donc la même contrainte de signature.
- APK actuellement actif : `/data/app/~~YpMdJiCC0HvWs4-wCSZMfw==/com.mikrolan.app-lsanTyVpika_TBqdwKCQLg==/base.apk`
- `versionCode=29`, `versionName=0.1.0`, `flags=0x0` (non-debuggable), `installerPackageName=null` (sideload).

---

## 26. Type de build

**Build release (ou release-like) non-debuggable**, réinstallé par sideload à 23:22:20. Ce n'est ni Expo Go, ni le development build que j'avais installé plus tôt (celui-ci était bien `DEBUGGABLE`, confirmé en Phase B). Un build non-debuggable ne tente jamais de contacter un serveur Metro — il exécute son bundle JS embarqué au moment de la compilation, ce qui explique intégralement l'absence totale de requête dans les logs Metro (§24) et l'affichage de l'ancien dashboard (code figé au moment du build release).

---

## 27. Méthode de résolution

Toutes les méthodes non destructives ont été épuisées :

- **A. Connexion USB** : `adb reverse tcp:8081 tcp:8081` reconfiguré et vérifié actif — sans effet, car l'app installée ne cherche pas à s'y connecter (non-debuggable).
- **B. Metro propre** : confirmé provenir du bon dossier, cache vidé (`--clear`), aucune requête reçue malgré plusieurs relances de l'app — cohérent avec la cause racine, pas un problème Metro.
- **C. Reload dev tools** : sans objet — un build release n'a pas de Dev Menu ni de mécanisme de reload JS.
- **D. Redémarrage non destructif** : `am force-stop` + `am start` répétés à plusieurs reprises — n'a jamais pu faire réapparaître mon code, car le binaire lui-même ne le contient plus.
- **Test d'installation non destructif** : `adb install -r` de mon APK debug déjà construit → échec propre par incompatibilité de signature, aucune donnée touchée (§23).

**Conclusion** : la seule voie restante est un remplacement du package installé (uninstall + reinstall du build debug), qui est une action interdite dans le périmètre actuel de cette phase → voir §28 (Étape 8, mini-plan, autorisation requise).

---

## 28-29. Validation visuelle et interactive réelle du nouveau dashboard

**Non obtenue.** Le nouveau dashboard n'a jamais pu s'afficher sur l'appareil pendant cette phase, pour la raison établie en §23 — le binaire installé ne contient pas mon code, indépendamment de tout problème de cache ou de connexion Metro (qui fonctionnent tous deux correctement, comme démontré en §24 et §27).

---

## 30. Captures du nouveau dashboard

**Aucune.** Impossible d'en produire tant que le build debug n'est pas réinstallé (voir §31, autorisation requise). Le dossier `C:\Users\PC\AppData\Local\Temp\mikrolan2-dashboard-validation\` n'a pas été créé — rien à y placer sans faire passer une capture de l'ancien build pour une validation, ce qui est explicitement interdit par le mandat.

---

## 31. État Git et sauvegarde externe

- Branche : `main` (le dépôt a changé de branche entre la Phase B et cette phase, via une session parallèle — signalé, non modifié par moi).
- `HEAD` : `15ddfca8006bcf091a753a4d6534512c1e040204`
- Un seul worktree (`C:/dev/mikrolan2`), pas de copie dupliquée du dépôt.
- Les trois fichiers UI (`ui.tsx`, `routeurs.tsx`, `index.tsx`) confirmés intacts avec exactement les modifications attendues (vérifié par recherche de marqueurs uniques dans chaque diff — `zIndex: 10`, `Mes routeurs`, tokens `weight`/`elevation`/`withAlpha`).
- Sauvegarde externe créée : `C:\Users\PC\AppData\Local\Temp\mikrolan2-ui-backup.patch` (45 160 octets, 1148 lignes), non appliquée, index Git non modifié.

---

## 32. Mini-plan — Étape 8 (escalade destructive à autoriser)

Aucune action destructive n'a été exécutée. Voici le plan exact si l'autorisation est donnée :

**Action proposée** : `adb uninstall com.mikrolan.app` puis `adb install "C:\dev\mikrolan2\mobile\android\app\build\outputs\apk\debug\app-debug.apk"` (APK déjà construit, disponible sur disque, aucun nouveau build nécessaire).

**Données qui seraient supprimées** :
- Session (jeton d'authentification) — récupérable par reconnexion manuelle (email/mot de passe), **je ne la saisirai pas moi-même**, il faudra le faire sur l'appareil comme en Phase B.
- Identifiants routeurs LAN enregistrés localement (`getLocalCredentials`) — un seul routeur concerné (FREEDOM HOME) sur ce compte ; à ressaisir manuellement si nécessaire pour les fonctions LAN locales (le mode « à distance » n'en a pas besoin).
- Préférences locales de l'app (verrou biométrique, etc.) — à reconfigurer si utilisées.

**Données préservées** : toutes les données côté serveur (routeurs, tickets, plans, comptes, historique) — rien de tout cela n'est stocké localement, uniquement en base côté API. Un `uninstall`/`reinstall` ne touche que ce téléphone, jamais la production.

**Vérification de récupérabilité des identifiants routeurs** : à faire depuis l'app elle-même après reconnexion (`router-settings.tsx` ou l'écran d'ajout de routeur) — hors du périmètre que je peux modifier, mais l'opération de lecture est sans risque.

**Procédure de reconnexion** : identique à la Phase B — l'utilisateur saisit lui-même ses identifiants sur l'appareil, je ne touche jamais au formulaire de connexion.

**Pourquoi l'effacement est désormais justifié** : c'est la seule voie techniquement possible restante pour obtenir un rendu réel de ce dashboard sur cet appareil — toutes les alternatives non destructives (§27) ont été épuisées et documentées avec preuve.

**Alternative avec package ID debug distinct** : **non disponible actuellement** — `android/app/build.gradle` ne définit aucun `applicationIdSuffix` pour le build type `debug` (vérifié, §25). En ajouter un permettrait à l'avenir de faire coexister un build debug (`com.mikrolan.app.debug`) et le build release (`com.mikrolan.app`) sans conflit de signature, mais cela exige de modifier un fichier de configuration native hors du périmètre UI actuellement autorisé (`ui.tsx`, `routeurs.tsx`, `index.tsx`) — à proposer séparément si souhaité pour l'avenir, pas fait ici.

**Risque de collision avec la session parallèle** : si celle-ci réinstalle à nouveau un build release pendant que je valide, le même blocage réapparaîtra. À signaler à l'utilisateur pour coordination avant de retenter.

---

## Verdict final

**NON VALIDÉ — ACTION DESTRUCTIVE À AUTORISER**

Le code du dashboard (`index.tsx`) est complet, cohérent avec le standard pilote, TypeScript PASS, aucune dépendance ajoutée, aucun fichier hors périmètre modifié. Le blocage est entièrement extérieur au code : un build release a été réinstallé sur l'unique appareil de test disponible par une action externe à cette session, rendant impossible tout rendu réel sans une réinstallation (uninstall + install du debug APK déjà construit) — action explicitement hors périmètre sans autorisation.
