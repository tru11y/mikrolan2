# Audit UI/UX — MikroLan2 Mobile

**Portée** : `C:\dev\mikrolan2\mobile` — lecture seule, aucune modification effectuée.
**Date** : 2026-08-07
**Auditeur** : Lead Mobile Product Designer + UX Architect + Senior Mobile Engineer (Claude)

---

## 1. Résumé exécutif

L'app mobile MikroLan2 est dans un état **beaucoup plus avancé qu'un audit de refonte classique ne le laisse supposer**. Un design system central (`src/components/ui.tsx`, 1397 lignes) existe déjà, porte le nom de code « Onyx & Aurora », et encode explicitement — en commentaires et en code — la direction artistique demandée : une règle de couleur unique et documentée, une échelle de mouvement, des primitives accessibles (réduction de mouvement, focus, labels), des états loading/empty/error systématisés (`Skeleton`, `SkeletonCard`, `ErrorState`, `Empty`), un système de toasts, et des dialogues de confirmation pour toute action destructive.

Le problème n'est donc pas « il n'y a pas de design system », mais **le design system n'est appliqué qu'à environ la moitié de l'app**. Les écrans les plus récents (`router/[id].tsx`, `admin.tsx`, `pro.tsx`, `notifications.tsx`) l'utilisent correctement de bout en bout. Les écrans plus anciens (`(tabs)/routeurs.tsx`, `(tabs)/account.tsx`, `(tabs)/rapport.tsx`, `sessions.tsx`, `ip-bindings.tsx`, `router-settings.tsx`, `internet-sharing.tsx`, `ticket-settings.tsx`, `add-router.tsx`, `fichiers.tsx`) réimplémentent les mêmes valeurs (couleurs, tailles, rayons) en littéraux bruts, avec un risque de dérive silencieuse.

Plus significatif : le design system encode une **règle sémantique de couleur explicite** (violet = interactif, or = argent/PRO, vert = ok, rouge = danger, gris = neutre) — et cette règle est déjà **violée à plusieurs endroits par le code applicatif lui-même** (voir §5). C'est le type de régression qu'un design system est censé rendre impossible, donc un signal fort que la migration doit être terminée, pas juste poursuivie superficiellement.

Aucun bug fonctionnel n'a été traité dans cet audit — conformément au mandat, l'app est jugée fonctionnellement correcte. L'objectif ici est exclusivement la cohérence visuelle, l'ergonomie et la préparation d'une refonte progressive.

---

## 2. Stack technique détectée

| Domaine | Détail |
|---|---|
| Framework | Expo SDK 54 (`expo: ~54.0.0`), React Native 0.81.5, React 19.1.0, `newArchEnabled: true` |
| Navigation | **Expo Router v6** (`expo-router: ~6.0.0`, `main: "expo-router/entry"`), routing fichier dans `app/`, `typedRoutes: false` |
| Langage | TypeScript strict (`tsconfig.json` étend `expo/tsconfig.base`, `"strict": true`), alias `@/*` |
| State / data | **React Query v5** (`@tanstack/react-query`) pour tout le data-fetching — aucune lib de state globale (pas de Redux/Zustand/Jotai). L'état applicatif transverse passe par des **React Context providers** dédiés (`AuthProvider`, `ActiveRouterProvider`, `AppLockProvider`, `LiveEventsProvider`, `PushNotificationsProvider`, `QueryProvider`, `ToastProvider`) |
| UI / icônes | `@expo/vector-icons` (Ionicons uniquement, une seule famille dans toute l'app) |
| Animations | **`Animated` de React Native natif** — pas de `react-native-reanimated` dans les dépendances. Toutes les animations (fade-in, spring de press, pulsation, shake de la cloche) passent par l'API historique `Animated.timing/spring/loop` |
| Gradient | `expo-linear-gradient` (utilisé pour `AuroraCard`) |
| QR / impression | `react-native-qrcode-svg` + `qrcode`, `expo-print`, `expo-sharing` (génération de PDF tickets) |
| Auth | `expo-secure-store` (tokens), `expo-local-authentication` (verrou biométrique), `expo-auth-session` + `expo-web-browser` (Google OAuth) |
| Réseau routeur | Client RouterOS API maison sur socket TCP épinglé (`react-native-tcp-socket`) — `src/services/mikrotik-lan/MikroTikApiClient.ts` — pas de lib tierce MikroTik |
| Safe area | `react-native-safe-area-context` — `SafeAreaProvider` au root (`app/_layout.tsx`), `useSafeAreaInsets()` utilisé correctement dans `AppHeader`, `BottomNav`, `login.tsx`, `PaywallLock.tsx`, `(tabs)/routeurs.tsx` |
| Notifications | `expo-notifications` (push), plus un fil « live events » interne par polling (`LiveEventsProvider`, 5 s) |

**Constat** : stack moderne et cohérente, sans dette d'outillage majeure. L'absence de Reanimated n'est pas un problème en soi (le volume d'animations reste simple), mais toute animation gestuelle (drag, swipe-to-dismiss) future butera sur les limites du thread JS de `Animated` — à anticiper si le plan de refonte inclut des interactions gestuelles avancées (Phase G).

---

## 3. Architecture UI actuelle

### Routing
`app/` (Expo Router, fichier = route) :
- `app/index.tsx` — écran de redirection pure (login vs `(tabs)`), pas un vrai écran.
- `app/(tabs)/` — groupe de routes avec un `Tabs` **dont le chrome natif est entièrement masqué** (`headerShown: false`, `tabBarStyle: { display: 'none' }` dans `app/(tabs)/_layout.tsx`). Chaque écran affiche son propre `<AppHeader>` et `<BottomNav>`.
- Écrans hors `(tabs)` empilés dans le `Stack` racine (`app/_layout.tsx`), avec des présentations dédiées : `add-router` et `pro`/`notifications` en modal (`slide_from_bottom`), le reste en `slide_from_right`.
- `app/router/[id].tsx` — route dynamique, tableau de bord d'un routeur.

C'est une décision architecturale assumée et documentée en commentaire (`app/(tabs)/_layout.tsx:4-7`) : éviter la double barre de titre qu'un header natif + un header applicatif produiraient. Le prix payé est que **chaque écran doit se souvenir** de monter `<AppHeader>` + `<BottomNav>` lui-même — un oubli est possible et invisible à la compilation.

### Navigation à deux modes
`src/components/BottomNav.tsx` bascule entre :
- **Mode global** (3 onglets : Maison / Routeurs / Paramètres) quand aucun routeur n'est « actif » ;
- **Mode routeur connecté** (5 onglets : Maison / Plans / Tickets / Fichiers / Rapport, + un bandeau « Quitter le mode routeur ») quand un routeur est sélectionné (`ActiveRouterProvider`).

C'est un modèle de navigation inhabituel mais délibéré (calqué sur la référence « MikroTicket »). Il fonctionne, mais crée une ambiguïté d'IA relevée en §14 : deux chemins différents mènent à « créer des tickets » selon qu'un routeur est actif ou non (`(tabs)/tickets.tsx` vs. l'onglet Tickets du mode routeur → `generate-vouchers`).

### Design system
`src/components/ui.tsx` centralise :
- **Tokens** : `theme` (couleurs), `motion` (durées/courbes), `radius`, `space`, `type`, `icon`.
- **Primitives d'état** : `Skeleton`, `SkeletonCard`, `Empty`, `ErrorState`, `Banner`, `ConfirmDialog` (vrai `Modal`, gère le bouton retour Android), `ToastProvider`/`useToast`.
- **Primitives de layout/texte** : `Screen`, `Card`, `Row`, `Title`/`Subtitle`/`Label`/`SectionTitle`/`Mono`, `Stat`, `Badge`, `Pill`, `IconChip`, `SegmentedOption`, `AuroraCard`.
- **Formulaires** : `Field`, `NumberField` (filtre de saisie strict + validation), `OutlinedField` (utilisé sur `login.tsx`), `FieldError`.
- **Accessibilité du mouvement** : `useReduceMotion()` branché sur `AccessibilityInfo.isReduceMotionEnabled()`, respecté par `FadeIn`, `Press`, `Skeleton`, `AnimatedNumber`, `ToastItem`, `NotificationBell`.

C'est un socle solide, bien au-dessus de la moyenne des apps React Native de ce stade. Le vrai chantier de refonte n'est pas de le construire (Phase A est déjà largement faite) mais de **finir sa propagation** (voir §18).

### Composants partagés hors `ui.tsx`
- `AppHeader.tsx` — header unique de l'app (titre + état du routeur actif + cloche + badge PRO + avatar compte).
- `BottomNav.tsx` — nav du bas, double mode (voir plus haut).
- `NotificationBell.tsx` — cloche avec badge animé, alimentée par `LiveEventsProvider`.
- `PaywallLock.tsx` — verrou plein écran quand l'essai est terminé, miroir d'un contrôle serveur (`EntitlementGuard`), pas une sécurité côté client.
- `ProAdvisor.tsx` — chatbot scripté (pas d'IA) qui recommande une formule PRO en 3 questions, très bien exécuté (bulles de chat, choix, note transmise à l'admin).
- `RouterStatusDot.tsx` — pastille de statut réutilisée, clignote uniquement si `ONLINE`.
- `TicketCard.tsx` / `TicketQr.tsx` — rendu du ticket imprimé, **en thème clair** (papier), volontairement déconnecté du thème sombre de l'app (cohérent avec un ticket physique, mais dupliqué avec `ticketsPdf.ts`, voir §9).

### Assets
Un seul asset image dans tout le repo : `assets/images/logo.png` (utilisé en icône, splash, adaptive icon Android, et dans `login.tsx`). Aucune iconographie custom SVG, aucune illustration.

---

## 4. Inventaire complet des écrans

| # | Écran | Fichier | Route | Rôle | Priorité |
|---|---|---|---|---|---|
| 1 | Redirection | `app/index.tsx` | `/` | Aiguillage login/tabs selon session | P0 (infra) |
| 2 | Connexion / Inscription | `app/login.tsx` | `/login` | Login, signup, Google OAuth, config serveur (dev) | **P0** |
| 3 | Tabs layout | `app/(tabs)/_layout.tsx` | — | Déclaration des routes tab (chrome natif masqué) | infra |
| 4 | Maison (dashboard global) | `app/(tabs)/index.tsx` | `/(tabs)` | Vue d'ensemble compte, revenu du jour, liste routeurs, essai/PRO | **P0** |
| 5 | Routeurs | `app/(tabs)/routeurs.tsx` | `/(tabs)/routeurs` | Liste de tous les routeurs, ajout | **P0** |
| 6 | Créer des tickets (picker) | `app/(tabs)/tickets.tsx` | `/(tabs)/tickets` | Sélection d'un routeur avant génération de tickets | **P0** |
| 7 | Rapport financier | `app/(tabs)/rapport.tsx` | `/(tabs)/rapport` | CA, répartition par forfait, clients récents, export CSV | **P0** |
| 8 | Mon compte | `app/(tabs)/account.tsx` | `/(tabs)/account` | Profil, notifications, verrou biométrique, mot de passe, suppression compte, accès admin | P1 (contient des actions sensibles → proche P0) |
| 9 | Tableau de bord routeur | `app/router/[id].tsx` | `/router/[id]` | Détail d'un routeur : CPU/RAM, accès distant, 4 tuiles stats, hotspot, raccourcis | **P0** |
| 10 | Ajouter un routeur | `app/add-router.tsx` | `/add-router` (modal) | Scan LAN, test connexion RouterOS, enregistrement | **P0** |
| 11 | Paramètres routeur | `app/router-settings.tsx` | `/router-settings` | Hub de réglages : anti-tethering, hotspot, appareils autorisés, sessions, ticket, WebFig/SSH/Winbox (PRO), reboot, suppression | P1 |
| 12 | Configurer le hotspot | `app/hotspot-setup.tsx` | `/hotspot-setup` | Reconfigure interface/réseau du hotspot (action destructive réseau) | P1 |
| 13 | Blocage du partage | `app/internet-sharing.tsx` | `/internet-sharing` | Anti-tethering TTL, mode bridge | P2 |
| 14 | Appareils autorisés | `app/ip-bindings.tsx` | `/ip-bindings` | CRUD des IP/MAC bindings (bypass/block/regular) | P1 |
| 15 | Utilisateurs actifs | `app/sessions.tsx` | `/sessions` | Sessions live, déconnexion forcée, recherche | P1 |
| 16 | Forfaits | `app/plans.tsx` | `/plans` | CRUD des plans WiFi (durée, prix, débit, format de code) | **P0** |
| 17 | Créer des tickets (génération) | `app/generate-vouchers.tsx` | `/generate-vouchers` | Génération de lots de tickets, impression, partage | **P0** |
| 18 | Fichiers | `app/fichiers.tsx` | `/fichiers` | Historique des lots, réimpression, révocation/suppression | P1 |
| 19 | Paramètres du ticket | `app/ticket-settings.tsx` | `/ticket-settings` | Personnalisation du reçu imprimé (14 toggles + champs) | P2 |
| 20 | Abonnement PRO | `app/pro.tsx` | `/pro` (modal) | Grille tarifaire, bascule mensuel/annuel, conseiller, demande d'activation | **P0** (paiement) |
| 21 | Notifications | `app/notifications.tsx` | `/notifications` (modal) | Fil de notifications, marquer lu | P1 |
| 22 | Administration | `app/admin.tsx` | `/admin` | Back-office SUPER_ADMIN : aperçu, demandes, comptes, formules | **P0** pour ce rôle (invisible aux clients) |

**Écrans morts** : aucun trouvé. Toutes les routes sont atteintes soit par `BottomNav`, soit par navigation directe (`router.push`) depuis un écran parent, soit par redirection conditionnelle (`PaywallLock`, `app/index.tsx`, `app/(tabs)/index.tsx` → `Redirect` vers `/router/[id]` si un routeur est actif).

**Point d'IA à noter** : `(tabs)/tickets.tsx` (#6) n'apparaît dans aucun des deux jeux d'onglets de `BottomNav` (`GLOBAL_TABS` a Maison/Routeurs/Paramètres ; le mode routeur a son propre onglet Tickets pointant directement vers `generate-vouchers`). Il n'est atteint que via la carte « Aperçu rapide des Tickets » sur `(tabs)/index.tsx`. Ce n'est pas un écran mort, mais un point d'entrée semi-caché qui duplique une partie du rôle de l'onglet Tickets du mode routeur — à clarifier en Phase C (voir §14, §18).

---

## 5. Problèmes critiques P0

### P0-1 — La règle de couleur sémantique du design system est violée par le code applicatif
`ui.tsx` documente explicitement (lignes 38-49) : *vert = ça va/actif, ambre = argent/PRO exclusivement, violet = interactif*. Trois écrans la contredisent :

- **`app/(tabs)/routeurs.tsx:128`** — le point « en ligne » utilise `theme.secondary` (violet) au lieu de `theme.success` (vert) :
  ```tsx
  <Dot color={theme.secondary} />
  <Text>...</Text> {online} en ligne
  ```
  Résultat : sur cet écran, « en ligne » est violet, alors que partout ailleurs dans l'app (badges `routerHealth`, `RouterStatusDot`) « en ligne » est vert. Incohérence visible dès le deuxième écran de l'app.

- **`app/internet-sharing.tsx`** (`OptionCard`, lignes ~262-279) — la sélection « Bloquer le partage » utilise `activeColor={theme.success}` (vert) comme couleur de *sélection*, et « Autoriser le partage » utilise `activeColor={theme.primary}` mais une icône `iconColor={theme.warning}` (ambre). Le vert n'y signifie pas « ça va » mais « choix coché », et l'ambre est utilisé comme décoration d'icône plutôt que pour de l'argent/PRO.

- **`app/ip-bindings.tsx:42-46`** (`TYPE_META`) — le type de binding neutre `regular` est coloré en `theme.warning` (ambre), la couleur explicitement réservée à « l'argent et l'abonnement PRO, rien d'autre ».

**Impact** : ce ne sont pas des bugs visuels graves isolément, mais ils cassent précisément la garantie que le design system a été construit pour donner (une seule lecture de couleur dans toute l'app). Un audit de refonte doit les corriger en premier, avant d'ajouter de nouveaux écrans qui copieraient le mauvais pattern.

### P0-2 — Le dashboard n'a pas d'état d'erreur réseau
`app/(tabs)/index.tsx` interroge `routers` et `metrics` via React Query mais ne teste jamais `query.isError` (contrairement à `admin.tsx`, `pro.tsx`, `notifications.tsx`). En cas d'échec réseau, `list = routers.data ?? []` et les champs `metrics.data?.xxx ?? 0` retombent silencieusement à zéro : l'écran affiche « 0 routeur en ligne, 0 FCFA de revenu du jour, 0 ticket » — indiscernable d'un compte réellement vide. C'est le premier écran métier vu après connexion et celui que l'opérateur consulte pour vérifier sa caisse : un faux « 0 FCFA » y est un risque de confiance disproportionné à l'ampleur du bug. Même lacune sur `app/(tabs)/tickets.tsx` (`routers` query sans branche `isLoading`/`isError` — un échec réseau y affiche le message « Aucun routeur, ajoutez-en un » au lieu d'une erreur réseau).

### P0-3 — Rupture de thème dans un flux PRO (paiement/gestion) via `Alert.alert` natif
`app/router-settings.tsx` (lignes 241-300) utilise l'`Alert` natif de React Native pour WebFig/SSH/Winbox — fonctionnalités PRO. C'est le seul endroit de toute l'app où une boîte de dialogue **non thémée** (blanche, police système, aucun token `theme`) apparaît, en plein milieu d'un parcours PRO payant, alors que l'app possède déjà `ConfirmDialog` (Modal thémé, gère le retour Android) utilisé ailleurs sur ce même écran pour le reboot et la suppression de routeur.

### P0-4 — Padding de sécurité incohérent sous la barre de navigation, sur les deux écrans tickets
`app/generate-vouchers.tsx:153` et `app/fichiers.tsx:166` utilisent `paddingBottom: 100` en dur, alors que tous les autres écrans utilisent `useBottomNavHeight()` — un hook créé précisément pour ce problème (commentaire de `BottomNav.tsx:16-19` : *« Une valeur en dur laissait le dernier item sous la barre en mode routeur, ou sur les téléphones à barre de gestion »*). Le mode routeur (5 onglets + bandeau « Quitter ») est plus haut que 100px sur beaucoup d'appareils : sur ces deux écrans précisément — génération et gestion des tickets, cœur du produit — le dernier élément de liste peut être masqué par la barre.

### P0-5 — Aucune prévisualisation du ticket pendant sa personnalisation
`app/ticket-settings.tsx` propose 14 interrupteurs/champs pour configurer le reçu imprimé (logo, mentions, QR, footer…) sans jamais afficher le rendu — alors que `TicketCard`/`TicketQr` existent déjà et sont utilisés ailleurs (`generate-vouchers.tsx`, `fichiers.tsx`). L'opérateur configure à l'aveugle et ne découvre le résultat qu'après avoir imprimé un lot réel.

---

## 6. Problèmes importants P1

- **Tokens non propagés** — littéraux bruts (`fontSize: 12`, `borderRadius: 16`, `gap: 12`, `padding: 16`…) au lieu de `type.*`/`radius.*`/`space.*`, sur la majorité des écrans plus anciens : `(tabs)/routeurs.tsx`, `(tabs)/tickets.tsx`, `(tabs)/account.tsx`, `(tabs)/rapport.tsx`, `sessions.tsx`, `ticket-settings.tsx`, `router-settings.tsx`, `internet-sharing.tsx`, `add-router.tsx`, `ip-bindings.tsx`, `fichiers.tsx`, `plans.tsx` (partiellement). C'est le plus gros chantier de cohérence de toute l'app (voir §10).
- **`thumbColor="#fff"` codé en dur sur chaque `<Switch>`** — `(tabs)/account.tsx:258,286`, `ticket-settings.tsx:49`, `router-settings.tsx:431`. Seule couleur de toute l'app qui ne référence aucun token.
- **`color: '#fff'` dupliqué** sur le badge de compteur — `NotificationBell.tsx:120` et `admin.tsx:859` (même motif copié-collé, jamais centralisé).
- **`Alert.alert` non thémé** — voir P0-3, à traiter comme un défaut de composant (créer une variante `ActionSheet`/`ConfirmDialog` à choix multiples dans `ui.tsx`) plutôt que corriger au cas par cas.
- **Aucun token d'ombre/élévation** — le FAB de `(tabs)/routeurs.tsx:172-176` est le seul endroit avec une ombre (`shadowColor/shadowOpacity/shadowRadius/elevation` en dur) ; rien dans `ui.tsx` ne définit d'échelle d'élévation, donc tout futur bouton flottant réinventera ces valeurs.
- **Microcopy trop technique pour la persona réelle** — `internet-sharing.tsx` (TTL, « Use IP Firewall », commande terminal RouterOS brute) et les alertes WebFig/SSH/Winbox de `router-settings.tsx` s'adressent à un profil réseau, alors que la persona documentée du projet est un petit commerçant/gérant de cyber, pas un administrateur MikroTik. Une partie est déjà repliée dans un accordéon (bonne pratique), l'autre (SSH/Winbox) ne l'est pas.
- **Deux chemins pour « créer des tickets »** — `(tabs)/tickets.tsx` (mode global) vs. onglet Tickets du mode routeur → `generate-vouchers` directement. Fonctionnellement correct, mais incohérent en IA (voir §14).
- **`ProAdvisor` (chatbot) et `proAdvisor.ts` utilisent des glyphes bruts** (`👋`, `⚠`) au lieu d'`Ionicons`, dans un texte transmis tel quel à l'admin (`src/lib/proAdvisor.ts:70,251`) — mineur mais à uniformiser si la note d'admin est un jour affichée dans `admin.tsx` avec le reste de l'iconographie Ionicons.

---

## 7. Améliorations secondaires P2

- Indentation JSX incohérente autour de certains `Banner`/`Subtitle` (`hotspot-setup.tsx:55`, `internet-sharing.tsx:137`, `ticket-settings.tsx:118`) — sans impact visuel (React Native ignore les blancs JSX), mais signale des fichiers non repassés par la dernière vague de polish.
- Convention `couleur + '22'/'44'/'55'/'66'` (alpha en suffixe hex) répétée à la main ~40+ fois dans toute l'app plutôt que via un helper `withAlpha(color, opacity)` — fonctionne tant que toutes les couleurs source restent des hex à 6 chiffres, fragile sinon.
- `router-settings.tsx` duplique une composition `Card` + `Label` + `Field` déjà standardisée ailleurs, au lieu de réutiliser un bloc « édition inline » commun (le pattern existe déjà dans `(tabs)/account.tsx` via `ActionRow`).
- Le module « Modèles » est masqué dans `BottomNav.tsx:28` (commentaire : *« pas encore backé »*) — probablement un residu d'un onglet prévu mais pas encore implémenté côté backend ; à confirmer/nettoyer avant la refonte.

---

## 8. Audit typographique

Échelle définie dans `ui.tsx:106-116` :
```
micro 11 · caption 12 · body 13 · bodyLg 15 · title 17 · h2 20 · h1 24 · display 32 · hero 40
```
Progression raisonnable (pas un ratio strict mais des paliers lisibles), avec un plancher explicite documenté (« rien en dessous de 11 »). Une seule famille de police (système), `theme.mono` (`Menlo`/`monospace`) réservée aux identifiants techniques (MAC, IP, codes de tickets) — bon principe, bien respecté.

**Manque** : pas de token de graisse (`fontWeight`). Les poids `'400'/'500'/'600'/'700'/'800'/'900'` sont choisis à la main à chaque usage, avec une tendance cohérente en pratique (700-800 pour les titres/valeurs, 600 pour les labels, 400 pour le corps) mais rien qui l'impose. Recommandation : ajouter un objet `weight` au même niveau que `type`.

**Respect de l'échelle** : bon dans les écrans récents (`router/[id].tsx`, `notifications.tsx`, `pro.tsx`, `admin.tsx`) ; largement contourné ailleurs par des `fontSize` littéraux (10, 11, 11.5, 13, 13.5, 14, 15…) qui ne correspondent à aucun palier du tableau — signe que l'échelle a été étoffée après coup sans repasser sur l'existant (ex. `add-router.tsx:208` `fontSize: 13.5`, `plans.tsx:110` `fontSize: 11`).

---

## 9. Audit des couleurs

Palette actuelle (`ui.tsx:51-72`) :

| Rôle | Valeur | Statut |
|---|---|---|
| Fond | `#0B0B12` | stable, cohérent partout (y compris `app.json` splash/adaptive icon) |
| Surface / surfaceAlt | `#15151F` / `#1C1C29` | stable |
| Bordure | `#2A2A3C` | stable |
| Texte / texte atténué | `#F2F3F8` / `#9AA0B4` | stable |
| **Primaire (violet)** | `#7B61FF` | « tout ce qui est interactif ou sélectionné + la marque » |
| Primaire clair | `#A78BFA` | hiérarchie secondaire dans la même famille |
| **`secondary` (déprécié)** | `= #A78BFA` (repointé sur le violet) | voir ci-dessous |
| **Or (`gold`)** | `#F5B84A` | « argent / tier PRO, exclusif » |
| Succès | `#34D399` | « ça va / actif / payé » |
| Danger | `#F87171` | « ça ne va pas / destructif » |
| Warning | `= gold` (assumé, commenté) | fusionné avec l'or par choix documenté |

**Constat majeur** : la direction artistique briefée « violet/cyan/or » **n'existe plus dans le code**. Le commentaire ligne 61-63 est explicite : l'ancien cyan a été repointé sur la famille violette (« *c'était la 4e teinte sans signifié* »). La palette réelle aujourd'hui est **violet + or + vert + rouge + gris**, quatre/cinq teintes fonctionnelles, sans cyan. C'est une décision de design assumée et documentée, probablement la bonne (moins de teintes = plus de clarté), mais elle **contredit le nom du projet Stitch/référence « Onyx & Aurora » violet/cyan** mentionné dans le contexte — à faire trancher explicitement avant de repartir sur des maquettes qui montreraient encore du cyan, pour ne pas travailler sur une DA déjà abandonnée en code.

Couleurs codées en dur trouvées hors `theme` (voir §6/§10 pour le détail) : `#fff` (Switch thumbs, badges), `#000000cc` (fond de dialogue, deux occurrences dans `ui.tsx` lui-même — acceptable car c'est le composant source), palette entière blanche/slate dans `TicketCard.tsx`/`TicketQr.tsx`/`ticketsPdf.ts` (voir §3 — intentionnel, thème « papier », mais `ticketsPdf.ts:95` réécrit `#7B61FF` en dur plutôt que d'importer `theme.primary`, donc un changement de violet de marque ne se propagerait pas au PDF).

Application de la règle sémantique : voir P0-1 (§5) pour les trois violations concrètes trouvées.

---

## 10. Audit des espacements

Échelle définie (`ui.tsx:95-103`) : `xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32`, et rayons `xs 4 · sm 10 · md 12 · lg 16 · xl 20 · pill 999`.

Bien respectée dans : `ui.tsx` lui-même, `router/[id].tsx`, `admin.tsx`, `pro.tsx`, `notifications.tsx`, `ProAdvisor.tsx`, `PaywallLock.tsx`.

Largement contournée (valeurs en dur qui ne correspondent à aucun palier, ou qui dupliquent un palier existant sans le référencer) dans : `(tabs)/routeurs.tsx` (`12, 16, 20, 28, 42, 56, 76`), `(tabs)/rapport.tsx` (`6, 8, 10, 12, 16, 30`), `(tabs)/account.tsx` (`10, 12, 14, 24`), `sessions.tsx` (`8, 10, 11, 12, 16, 20, 38, 40, 42`), `router-settings.tsx` (`8, 10, 12, 14, 16, 40`), `internet-sharing.tsx` (`3, 4, 6, 8, 12, 16, 24, 40, 56`), `add-router.tsx` (`4, 6, 8, 9, 10, 11, 12, 14, 90`), `ip-bindings.tsx`, `fichiers.tsx`, `plans.tsx`.

Ce n'est pas une dérive incontrôlée (les valeurs restent dans un ordre de grandeur cohérent — pas de 3px à côté d'un 47px), mais c'est exactement le genre d'écart qu'un système à jetons est censé éliminer, et qui rend un futur changement de densité (ex. mode compact) impossible à faire par un seul point de bascule.

---

## 11. Audit de l'iconographie

**Une seule librairie** : `@expo/vector-icons` → `Ionicons`, dans tout `app/` et `src/`. C'est un vrai point fort, rare à ce stade d'un projet — pas de mélange de styles, pas d'icônes SVG custom en parallèle.

**Convention observée** (cohérente, à documenter explicitement dans le design system) :
- variante *outline* = état neutre/inactif (`home-outline`, `notifications-outline`) ;
- variante *pleine* = état actif/sélectionné (`notifications`, icônes de `BottomNav` en couleur primaire quand actives).

**Tailles** : `icon.sm 16 / md 20 / lg 24 / xl 28` (`ui.tsx:118`), bien suivies dans les composants partagés (`IconChip`, `BottomNav`, `AppHeader`), moins strictement dans les écrans (tailles `13, 14, 15, 17, 18, 20, 22, 24, 26` trouvées en dur dans `sessions.tsx`, `internet-sharing.tsx`, `router-settings.tsx`, `plans.tsx`).

**Emoji comme icône** : aucun trouvé dans l'UI structurelle (boutons, badges, navigation). Deux glyphes bruts hors-Ionicons dans du texte de chat (`proAdvisor.ts`, voir §6) — acceptable en contexte conversationnel, à surveiller si ce texte finit affiché ailleurs.

**Labels accessibles** : globalement bons — `accessibilityLabel` posé sur la majorité des boutons icône-seul (`AppHeader`, `BottomNav`, `NotificationBell`, `Press`, FAB de `routeurs.tsx`). Voir §15 pour les trous restants.

**Recommandation pour la suite** : garder Ionicons comme unique source, geler la convention outline/plein ci-dessus dans la doc du design system (elle n'est aujourd'hui qu'implicite), et migrer les tailles en dur vers le token `icon.*`.

---

## 12. Audit notifications, messages et microcopy

**Ton général** : français correct, chaleureux sans être infantilisant, cohérent avec le reste du produit (« Bienvenue, {prénom} », « Votre essai est terminé », etc.). Les messages d'erreur passent par `extractErrorMessage`/`describeError` (`src/lib/errors.ts`) plutôt que d'afficher des erreurs techniques brutes — bonne pratique déjà en place.

**Points forts** :
- `PaywallLock.tsx` explique clairement ce qui est perdu/conservé (« Vos routeurs et vos tickets sont conservés »).
- `router-settings.tsx` (suppression) et `(tabs)/account.tsx` (suppression de compte) ont des messages de confirmation qui énumèrent précisément les conséquences plutôt qu'un « êtes-vous sûr ? » générique.

**Points faibles** (reformulations proposées, à titre indicatif — pas de changement de code) :

| Écran / ligne | Texte actuel | Problème | Proposition |
|---|---|---|---|
| `internet-sharing.tsx:153` | « Schéma de blocage anti-tethering (détection TTL) » | jargon réseau non traduit | « Comment ça bloque le partage » |
| `internet-sharing.tsx:212` | « Partage bloqué (TTL décrémenté) » | acronyme technique exposé au client | « Partage détecté et bloqué » |
| `internet-sharing.tsx:325-333` | « Si vos interfaces WiFi et Ethernet sont en mode Bridge […] cocher Use IP Firewall […] Commande Terminal: /interface bridge settings set use-ip-firewall=yes » | commande RouterOS brute affichée telle quelle, illisible pour la persona cible | Repli systématique derrière « Configuration avancée (technicien) », sans la commande en clair — ou bouton « Appliquer automatiquement » si l'API le permet |
| `add-router.tsx:167` | « Port API RouterOS (défaut 8728). Les identifiants restent sur votre téléphone. » | deux informations de nature différente compressées dans une phrase | Séparer aide contextuelle du port et note de confidentialité |
| `hotspot-setup.tsx:56` | « Cette action modifie le réseau du routeur (adresse, DHCP, serveur hotspot). À n'utiliser que sur un routeur sans hotspot existant. » | avertissement correct mais noyé dans un `Banner` warning au même niveau visuel que le reste — pas de friction supplémentaire pour une action aussi destructive | Passer par un `ConfirmDialog` explicite avant `configure()`, comme pour le reboot |
| `router-settings.tsx` (Alert SSH/Winbox) | « Aucun client SSH détecté. » / « Application MikroTik non installée. » | ton correct, mais présenté dans une alerte système non thémée | Migrer vers `ConfirmDialog`/`ActionSheet` du design system |

---

## 13. Audit états loading, empty, error et success

C'est l'un des points les plus mûrs de l'app. `ui.tsx` fournit `Skeleton`/`SkeletonCard` (chargement), `Empty` (liste vide, avec action optionnelle), `ErrorState` (erreur avec bouton Réessayer), `Banner` (info ponctuelle), `ToastProvider` (confirmation/erreur passagère) — et un commentaire explicite justifie chaque choix (ex. `ErrorState` existe parce que *« l'app affichait des Banner rouges sans issue […] donc il tuait l'app »*, `ui.tsx:772-775`).

**Bien couvert** : `admin.tsx`, `pro.tsx`, `notifications.tsx`, `router/[id].tsx`, `plans.tsx`, `ip-bindings.tsx`, `generate-vouchers.tsx`.

**Lacunes identifiées** :
- `(tabs)/index.tsx` — pas d'état d'erreur pour `routers`/`metrics` (P0-2, §5).
- `(tabs)/tickets.tsx` — pas d'état de chargement ni d'erreur pour `routers` (§5/§6).
- `(tabs)/account.tsx`, `(tabs)/rapport.tsx` (partiellement) — s'appuient sur les valeurs par défaut du contexte (`me?.user.xxx ?? '—'`) plutôt que sur un état de chargement explicite ; acceptable pour un écran de profil déjà chargé en amont, mais à vérifier au premier accès à froid.
- Aucun état **disabled** cohérent au niveau design system pour les items de liste non cliquables (ex. un routeur hors ligne dans `(tabs)/index.tsx` reste entièrement cliquable et opaque à 100 %, alors que `(tabs)/routeurs.tsx` applique `opacity: 0.65` sur les cartes hors ligne — incohérence mineure entre les deux vues de la même donnée).
- État **pressed** : géré uniquement via le composant `Press` (assombrissement + scale) — les écrans qui utilisent un `Pressable` brut au lieu de `Press` (majorité des écrans non « touchés » par le design system, voir §6) n'ont **aucun retour tactile visuel**, seul le retour haptique/à-plat du système reste (ex. `(tabs)/account.tsx` `ActionRow`, `router-settings.tsx` items de liste, `sessions.tsx` bouton refresh).

---

## 14. Audit navigation et ergonomie mobile

- **Un seul header, une seule nav du bas** — décision forte et bien exécutée (voir §3), c'est la meilleure protection structurelle contre l'incohérence de navigation typique des apps RN qui grandissent vite.
- **Bascule 3 ↔ 5 onglets selon le contexte** — fonctionnellement logique (le mode routeur ajoute Plans/Tickets/Fichiers scoping implicitement au routeur actif), mais représente une charge cognitive : le nombre et l'ordre des onglets changent selon un état invisible (y a-t-il un routeur actif ?) plutôt que selon une action explicite de l'utilisateur au moment où il regarde la barre. Un utilisateur qui revient sur l'app après un moment peut ne plus se souvenir « pourquoi j'ai 5 onglets maintenant ». Le bandeau « Quitter le mode routeur » atténue ce risque mais ne l'élimine pas.
- **Usage à une main** — la nav du bas et les FAB sont bien positionnés (zone de pouce). Le header, en revanche, concentre beaucoup d'actions en haut à droite (cloche, badge PRO, avatar) sur une seule ligne de 56px — acceptable au pouce en usage occasionnel, plus tendu en usage répété.
- **Gestes** — `gestureEnabled: true` sur le `Stack` racine (retour par glissement standard iOS/Android), cohérent.
- **Doublon d'entrée « créer des tickets »** — voir §6, à trancher en Phase C : soit fusionner `(tabs)/tickets.tsx` dans le flux du routeur, soit en faire clairement un raccourci de démarrage rapide distinct et le documenter comme tel.
- **Profondeur de pile** — certains parcours (Maison → Routeur → Paramètres routeur → Appareils autorisés) atteignent 3-4 niveaux ; le bouton retour de `AppHeader` (`back` prop) est cohérent partout, bon point.

---

## 15. Audit accessibilité

**Points forts** :
- `useReduceMotion()` respecté par toutes les primitives animées du design system (`FadeIn`, `Press`, `Skeleton`, `AnimatedNumber`, `ToastItem`, `NotificationBell`).
- `accessibilityLabel` posé sur la quasi-totalité des boutons icône-seul dans les composants partagés et les écrans récents.
- `accessibilityRole`/`accessibilityState` gérés dans `Press`, `Field`, `SegmentedOption`, `ConfirmDialog`.
- `FieldError` associe une icône ET une couleur au message d'erreur (`ui.tsx:424-434`, commentaire explicite sur le daltonisme) — bonne pratique rare.
- `accessibilityLiveRegion="polite"` sur les toasts.

**Lacunes** :
- Contraste : `theme.textMuted` (`#9AA0B4`) sur `theme.bg`/`theme.surface` (`#0B0B12`/`#15151F`) — à vérifier au ratio WCAG AA (le gris semble limite sur les tailles `micro`/`caption` 11-12px utilisées pour des libellés informatifs comme les sous-titres de sessions ou les unités « FCFA »/« / mois »). Aucun outil de contraste n'a été exécuté dans cet audit (lecture de code seule) — à valider avec un contrôleur de contraste avant la refonte.
- Cibles tactiles : plusieurs boutons icône font 34×34 ou 38×38 (`AppHeader` retour/compte, `sessions.tsx` déconnexion) — sous la cible recommandée de 44×44 iOS / 48×48 Android. `hitSlop` est utilisé par endroits (`OutlinedField`, `Press` l'expose en prop) mais pas systématiquement sur ces boutons 34-38px.
- `Pressable` bruts sans `accessibilityLabel` : plusieurs items de liste cliquables entiers (une carte routeur, une carte session) n'ont pas de label composite explicite — le lecteur d'écran lira le texte visible dans l'ordre DOM, ce qui fonctionne mais sans garantie d'un ordre de lecture optimal.
- Aucune vérification trouvée de la taille de police dynamique du système (Dynamic Type / Font Scale) — les tailles sont en `fontSize` fixes ; RN les scale par défaut avec les réglages d'accessibilité système sauf si `allowFontScaling={false}` est posé quelque part (non trouvé dans le code lu, donc probablement OK par défaut), mais aucun test de mise en page à échelle de police 150-200 % n'est visible dans le code (pas vérifiable en lecture seule).

---

## 16. Direction artistique recommandée

Le design system actuel est déjà proche de la cible demandée (sobre, contenu avant décoration, une couleur = un sens, mouvement fonctionnel, accessibilité prise en compte). Recommandations pour la suite :

1. **Trancher officiellement l'abandon du cyan.** Le code a déjà pris cette décision (commentaire `ui.tsx:61-63`) ; il faut l'aligner avec le nom « Onyx & Aurora » et toute maquette Stitch existante qui montrerait encore un violet/cyan. Soit renommer la DA en interne (ex. « Onyx & Améthyste »), soit réintroduire un cyan avec un sens propre (ex. réservé aux métriques réseau live — CPU/RAM utilisent déjà `theme.secondary` dans `router/[id].tsx`, ce qui serait un bon point d'ancrage pour une vraie 4ᵉ couleur sémantique si le produit en a besoin).
2. **Finir la propagation, ne pas relancer une nouvelle DA.** Le travail de fond (palette, tokens, primitives, accessibilité du mouvement) est fait. Le risque principal d'une refonte mal cadrée serait de repartir de zéro sur un système déjà correct au lieu de finir sa migration — voir plan §18.
3. **Ajouter les jetons manquants** : `weight` (graisses de police), une échelle d'élévation/ombre, un helper `withAlpha()`.
4. **Documenter les conventions implicites** : outline/plein en iconographie (§11), quand utiliser `Card` vs. bloc `View` manuel (aujourd'hui les deux coexistent pour le même usage — listes de réglages notamment).
5. **Garder l'app à une main, contenu avant décoration** : aucun signe de sur-décoration actuellement (pas de gradients abusifs à part `AuroraCard`, usage cohérent et non prétexte) — à préserver en résistant à la tentation d'ajouter des effets lors de la propagation aux écrans restants.
6. **Identité propre** : le mélange dark-first + violet + accents or fonctionne déjà et ne ressemble ni à un clone iOS ni à un template SaaS générique — à consolider, pas à réinventer.

---

## 17. Écran pilote recommandé et justification

**Écran pilote proposé : `app/(tabs)/routeurs.tsx`** (liste des routeurs).

Justification :
- **Représentatif** : contient à peu près tous les patterns UI de l'app — liste avec `FlatList`, carte cliquable, badges de statut, recherche implicite (compte en ligne/hors ligne), FAB, pull-to-refresh, état vide, état d'erreur. Un travail dessus valide la quasi-totalité du design system en une seule passe.
- **Peu risqué** : lecture seule côté métier — aucune écriture, aucun paiement, aucun changement de configuration réseau. Une régression visuelle ou un bug d'interaction y a un impact minimal comparé à `generate-vouchers.tsx` ou `pro.tsx`.
- **Contient déjà la P0-1 la plus visible** (`theme.secondary` au lieu de `theme.success`, §5) — un bon test que la Phase B (écran pilote) corrige aussi les incohérences sémantiques trouvées, pas seulement l'esthétique.
- **Accessible en 2 taps depuis la connexion** — bon candidat pour un test utilisateur rapide après refonte.

**À éviter comme pilote** (explicitement exclus par le mandat) : `generate-vouchers.tsx`, `pro.tsx`, `add-router.tsx`, tout écran de `router-settings.tsx`/`hotspot-setup.tsx`/`internet-sharing.tsx` (actions destructives ou provisioning).

---

## 18. Plan d'implémentation progressif

**Phase A — Fondations design system (finir, pas reconstruire)**
Ajouter les jetons manquants (`weight`, élévation, `withAlpha()`) à `ui.tsx`. Corriger les 3 violations de règle sémantique (P0-1). Centraliser `thumbColor`/couleurs blanches en dur. Décider du sort du cyan (§16.1). Livrable : `ui.tsx` v2 + une checklist « ce qui est désormais interdit en littéral » pour la revue de code.

**Phase B — Écran pilote**
`app/(tabs)/routeurs.tsx` : migration complète vers les tokens, correction de la couleur « en ligne », passage des `Pressable` bruts vers `Press`, ajout d'un état pressed cohérent, vérification du contraste des libellés `textMuted`. Sert de gabarit de référence documenté (avant/après, captures) pour les phases suivantes.

**Phase C — Navigation / shell global**
Résoudre le doublon « créer des tickets » (§6/§14). Documenter et, si besoin, simplifier la bascule 3↔5 onglets. Vérifier les cibles tactiles du header (§15).

**Phase D — Composants partagés**
Ajouter au design system : variante `ActionSheet`/`ConfirmDialog` à choix multiples (pour remplacer `Alert.alert`, P0-3), `Divider` officiel (actuellement réimplémenté localement dans `account.tsx` et `ticket-settings.tsx`), aperçu de ticket embarquable (pour Phase F).

**Phase E — Écrans P0**
Dans l'ordre de risque croissant : `(tabs)/index.tsx` (ajouter `ErrorState`, corriger P0-2), `(tabs)/tickets.tsx` (idem), `(tabs)/account.tsx`, `(tabs)/rapport.tsx`, `router/[id].tsx` (déjà propre, revue légère), `login.tsx` (déjà propre, revue légère), `plans.tsx`, `generate-vouchers.tsx` (corriger P0-4), `pro.tsx` (déjà propre, revue légère).

**Phase F — Écrans P1/P2**
`router-settings.tsx` (remplacer les `Alert.alert`, P0-3), `sessions.tsx`, `ip-bindings.tsx`, `fichiers.tsx` (corriger P0-4), `ticket-settings.tsx` (ajouter la prévisualisation, P0-5), `hotspot-setup.tsx`, `internet-sharing.tsx` (retravailler la microcopy, §12), `add-router.tsx`, `notifications.tsx` (déjà propre).

**Phase G — Micro-interactions**
Harmoniser les transitions entre écrans (déjà bonnes globalement), ajouter un retour visuel systématique sur toute action asynchrone (actuellement inégal selon que l'écran utilise `Button`/`Press` du design system ou un `Pressable` brut).

**Phase H — Accessibilité / QA**
Audit de contraste avec un outil dédié (WCAG AA, non fait ici faute d'outillage en lecture seule), passage de toutes les cibles tactiles à 44×44 minimum, test à échelle de police système 150-200 %, test lecteur d'écran (VoiceOver/TalkBack) sur les 5 écrans P0.

---

## 19. Risques de régression

- **`admin.tsx` (888 lignes, back-office SUPER_ADMIN)** est le fichier le plus volumineux et le plus riche en logique métier (facturation, activation de comptes) — toute refonte doit s'y limiter au visuel, avec une revue fonctionnelle dédiée avant merge, car son rôle n'est utilisé que par un seul profil et les régressions y sont moins vite détectées en usage réel.
- **`src/lib/api.ts` (1225 lignes) n'a pas été audité en détail** dans le cadre de cette mission UI (hors périmètre) — toute modification de composant qui changerait la forme des données affichées doit être vérifiée contre les types exportés ici.
- **Écrans avec accès réseau direct au routeur (LAN pinned socket)** — `router/[id].tsx`, `add-router.tsx`, `sessions.tsx`, `ip-bindings.tsx`, `plans.tsx`, `generate-vouchers.tsx` contiennent une logique de sous-réseau (`sameSubnet24`) qui protège contre un crash du socket TCP épinglé hors du bon réseau (commentaire répété dans plusieurs fichiers). Toute refonte visuelle de ces écrans doit être un patch chirurgical sur le JSX, sans toucher aux `useCallback`/`useFocusEffect` qui portent cette logique.
- **`PaywallLock.tsx`** — n'est qu'un miroir d'un contrôle serveur assumé comme tel dans le code. Une refonte visuelle est sans risque de sécurité, mais toute modification de `OPEN_ROUTES` doit être coordonnée avec le comportement serveur (`EntitlementGuard`, hors périmètre mobile).
- **`ProAdvisor.tsx`/`proAdvisor.ts`** — logique de script conversationnel non triviale (machine à états `AdvisorEngine`) ; le composant visuel (`ProAdvisor.tsx`) peut être retouché librement, le moteur (`src/lib/proAdvisor.ts`) ne fait pas partie du périmètre UI.
- **`ticketsPdf.ts`** génère un HTML imprimé séparé de `TicketCard.tsx`/`TicketQr.tsx` — toute modification de la palette « papier » doit être répercutée aux deux endroits manuellement tant qu'ils ne sont pas unifiés (voir §9).

---

## 20. Fichiers qui seront probablement concernés

**Design system (Phase A/D)**
- `src/components/ui.tsx`
- `src/components/AppHeader.tsx`, `src/components/BottomNav.tsx`, `src/components/NotificationBell.tsx`

**Écran pilote (Phase B)**
- `app/(tabs)/routeurs.tsx`

**Écrans P0 (Phase E)**
- `app/(tabs)/index.tsx`, `app/(tabs)/tickets.tsx`, `app/(tabs)/account.tsx`, `app/(tabs)/rapport.tsx`
- `app/router/[id].tsx` (revue légère), `app/login.tsx` (revue légère)
- `app/plans.tsx`, `app/generate-vouchers.tsx`, `app/pro.tsx` (revue légère), `app/add-router.tsx`

**Écrans P1/P2 (Phase F)**
- `app/router-settings.tsx`, `app/sessions.tsx`, `app/ip-bindings.tsx`, `app/fichiers.tsx`
- `app/ticket-settings.tsx`, `app/hotspot-setup.tsx`, `app/internet-sharing.tsx`
- `app/notifications.tsx` (revue légère), `app/admin.tsx` (revue légère, prudence fonctionnelle §19)

**Tickets / impression (Phase D/F)**
- `src/components/TicketCard.tsx`, `src/components/TicketQr.tsx`, `src/lib/ticketsPdf.ts`

**Hors périmètre UI, à ne pas toucher sans revue dédiée**
- `src/lib/api.ts`, `src/lib/proAdvisor.ts`, `src/services/mikrotik-lan/**`, `src/providers/**` (logique, pas présentation), `src/lib/router-credentials.ts`, `src/lib/sessionSync.ts`, `src/lib/lanBinder.ts`

---

## Résumé ultra-concis

- **Rapport** : `C:\dev\mikrolan2\UI_UX_AUDIT.md`
- **Framework** : Expo SDK 54 + Expo Router v6 + React Native 0.81.5 + React 19, TypeScript strict, React Query (pas de Redux/Zustand), Ionicons, `Animated` natif (pas de Reanimated).
- **Écrans trouvés** : 22 routes (dont 1 redirection technique et 1 layout tabs), classées 12 P0 / 7 P1 / 3 P2. Aucun écran mort.
- **Les 5 problèmes les plus critiques** :
  1. Violation de la règle sémantique de couleur du design system lui-même à 3 endroits (`(tabs)/routeurs.tsx` « en ligne » en violet au lieu de vert ; sélection en vert dans `internet-sharing.tsx` ; ambre PRO réutilisé pour un type neutre dans `ip-bindings.tsx`).
  2. Dashboard (`(tabs)/index.tsx`) et picker de tickets (`(tabs)/tickets.tsx`) sans état d'erreur réseau — un échec silencieux affiche « 0 FCFA / 0 routeur ».
  3. `Alert.alert` natif non thémé dans un flux PRO (`router-settings.tsx`, WebFig/SSH/Winbox) alors que `ConfirmDialog` existe déjà.
  4. `paddingBottom: 100` en dur sur les deux écrans tickets (`generate-vouchers.tsx`, `fichiers.tsx`) au lieu de `useBottomNavHeight()` — risque de contenu masqué par la nav.
  5. Aucune prévisualisation du ticket dans `ticket-settings.tsx` malgré l'existence de `TicketCard`/`TicketQr`.
- **Écran pilote recommandé** : `app/(tabs)/routeurs.tsx` — représentatif de tous les patterns UI, aucune écriture ni paiement, contient déjà l'une des violations de couleur à corriger en exemple.
- **Palette « Onyx & Aurora »** : violet + or sont solidement en place et documentés dans le code avec une règle sémantique explicite ; **le cyan a été retiré du code** (repointé sur le violet, décision déjà prise et commentée) — à aligner formellement avec le nom de la DA et toute maquette Stitch existante avant de poursuivre.
- **Informations manquantes / questions ouvertes** :
  - Aucun contrôle de contraste WCAG AA exécuté (audit en lecture de code seule, pas d'outil de rendu) — à faire avant la Phase H.
  - Le statut réel du cyan dans le projet Stitch (`project_mikrolan2_stitch_redesign`) n'a pas été comparé au code — à vérifier si des maquettes existantes montrent encore du cyan.
  - `src/lib/api.ts` (1225 lignes) n'a pas été audité en détail (hors périmètre UI) — les types de données n'ont pas été validés contre chaque écran listé.
  - Le module « Modèles » masqué dans `BottomNav.tsx` (backend pas encore prêt) n'a pas de calendrier connu — à clarifier avant d'ajouter un onglet dans une refonte de nav.
