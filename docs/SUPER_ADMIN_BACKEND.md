# Back-office super admin

État au 2026-08-02. **Implémenté et vérifié en local** (migration appliquée,
build vert, tests de rôle verts, parcours de bout en bout rejoué). Reste à
déployer sur le VPS — voir la section « Déploiement » en fin de document.

## Modèle de données

Migration `20260801223609_admin_backoffice_tiers_events`.

| Ajout | Où | Pourquoi |
|---|---|---|
| `SubscriptionTier` | nouveau modèle, **hors tenant** | la grille tarifaire, pilotée par le super admin |
| `BillingPeriod` (`MONTHLY`/`ANNUAL`) | enum | la périodicité est facturée, donc stockée |
| `Subscription.tierId`, `.billingPeriod` | FK + colonne | savoir *quelle* formule un compte a souscrite |
| `Invoice.tierId`, `.billingPeriod`, `.periodDays`, `.note` | colonnes | la note du conseiller vivait dans `AuditLog.metadata`, illisible depuis la file d'attente |
| `User.lastLoginAt` | colonne | distinguer un compte actif d'un compte abandonné |
| `AuditAction.SUSPEND` / `.RESTORE` | enum | tracer les décisions d'administration |
| `NotificationType` × 4 | enum | `SESSION_ENDED`, `SUBSCRIPTION_ACTIVATED`, `UPGRADE_REQUESTED`, `ROUTER_OFFLINE` |
| Index | `Tenant(createdAt)`, `Tenant(status)`, `User(tenantId, createdAt)`, `User(createdAt)`, `Invoice(status, createdAt)`, `Subscription(status)` | pagination par curseur et file d'attente sans seq scan |

**Règle de facturation :** `Invoice.amount` est figé à l'émission. Une révision
de la grille ne réécrit jamais une facture déjà émise — vérifié par un test de
bout en bout (tarif porté à 18 000 puis ramené à 15 000 : la facture reste à
162 000).

## Routes

Toutes sous `/api`. `AdminController` porte `@Roles(SUPER_ADMIN)` **au niveau de
la classe** : une route ajoutée demain est fermée par défaut.

### Grille tarifaire

| Méthode | Chemin | Rôle |
|---|---|---|
| `GET` | `/subscriptions/tiers` | tout compte authentifié — c'est ce que lit l'app |
| `GET` | `/admin/tiers` | `SUPER_ADMIN` (archivées comprises) |
| `POST` | `/admin/tiers` | `SUPER_ADMIN` |
| `PATCH` | `/admin/tiers/:id` | `SUPER_ADMIN` |
| `DELETE` | `/admin/tiers/:id` | `SUPER_ADMIN` — **archive**, ne supprime pas |

L'archivage plutôt que la suppression : des abonnements et des factures pointent
sur la formule, et l'historique de facturation doit rester lisible.

### Comptes, utilisateurs, file d'attente

| Méthode | Chemin | Notes |
|---|---|---|
| `GET` | `/admin/tenants?q=&status=&cursor=&limit=` | pagination curseur |
| `GET` | `/admin/tenants/:id` | détail + abonnement + utilisateurs + routeurs + 10 dernières factures |
| `PATCH` | `/admin/tenants/:id/status` | `ACTIVE`/`SUSPENDED` |
| `GET` | `/admin/users?q=&tenantId=&cursor=&limit=` | |
| `PATCH` | `/admin/users/:id/status` | `ACTIVE`/`SUSPENDED` |
| `GET` | `/admin/invoices?status=PENDING` | la file de travail quotidienne, avec la note du client |
| `GET` | `/admin/metrics` | comptes, MRR, essais, routeurs, tickets 30 j |
| `GET` | `/admin/audit?tenantId=&action=&cursor=` | lecture seule |

Garde-fous codés dans `admin.service.ts` :

- pagination **curseur** (`cursor` = id du dernier élément, `nextCursor: null`
  en fin de liste) — un `offset` dérive dès qu'une ligne est insérée ;
- recherche à partir de **3 caractères** — en dessous, `?q=a` reviendrait à
  énumérer les adresses e-mail de la plateforme ;
- impossible de suspendre son propre compte, ni un `SUPER_ADMIN` ;
- une suspension révoque les refresh tokens. Les jetons d'accès déjà émis
  restent valides jusqu'à expiration (quelques minutes) : le `JwtAuthGuard` ne
  relit pas le statut en base à chaque requête, et l'y ajouter coûterait une
  requête par appel.

**MRR** : calculé sur les abonnements actifs ramenés au mois, jamais sur les
factures — une facture annuelle encaisse douze mois d'un coup et ferait bondir
la courbe sans que rien n'ait changé. Les abonnements activés avant la grille
n'ont pas de formule : ils sont exclus du MRR et remontés dans
`revenue.untieredActive` plutôt que de fausser le chiffre en silence.

### Temps réel (SSE)

| Méthode | Chemin | Rôle |
|---|---|---|
| `GET` | `/events/stream` | tout compte — canal du tenant, `@AlwaysAllowed` |
| `GET` | `/events/platform` | `SUPER_ADMIN` — demandes d'activation, incidents |

Le canal du tenant reste ouvert même quand l'essai a expiré : c'est par là que
le client apprend que son paiement a été validé.

- bus en mémoire (`events.service.ts`), un `Subject` RxJS par canal ;
- **tampon de reprise** de 100 évènements par canal, battement de cœur toutes
  les 20 s (sans quoi un proxy coupe la connexion), ménage des canaux inactifs
  au bout de 15 min ;
- `publish()` ne lève jamais : un évènement perdu ne doit pas faire échouer
  l'opération métier qui l'a déclenché ;
- `@NoEnvelope()` exclut ces routes de l'enveloppe `{ success, data, … }`, qui
  emballait chaque message et rendait le flux illisible.

⚠️ **Piège vérifié :** NestJS écrit **sa propre numérotation** dans la ligne
`id:` du flux — un battement de cœur émis sans id ressort quand même en
« id: 1 ». Le curseur de reprise est donc l'identifiant porté par la **charge
utile JSON**, pas la ligne `id:`, et `readLastEventId()` fait primer le
paramètre de requête sur l'en-tête `Last-Event-ID`.

Évènements publiés :

| Type | Déclencheur | Source |
|---|---|---|
| `VOUCHER_ACTIVATED` | un ticket se connecte | `sessions.service.ts` |
| `SESSION_ENDED` | fin de session hotspot | `sessions.service.ts` |
| `SUBSCRIPTION_ACTIVATED` | le super admin valide un paiement | `subscriptions.service.ts` |
| `UPGRADE_REQUESTED` | un client demande PRO (canal plateforme) | `subscriptions.service.ts` |
| `ROUTER_OFFLINE` | transition en ligne → hors ligne | `wireguard-reconciler.service.ts` |

`ROUTER_OFFLINE` n'est émis **que sur la transition** : sans cela un routeur
éteint réémettrait une alerte toutes les minutes.

## Portée assumée : un seul processus

Le bus vit en mémoire. Les abonnés d'une instance ne voient que les évènements
publiés par cette instance — exact tant que l'API tourne dans un conteneur
unique, ce qui est le cas en production. Passer à plusieurs répliques impose de
remplacer le `Subject` par un pub/sub Redis ; seul `events.service.ts`
changerait.

## Côté application

- `src/lib/sse.ts` — client SSE sur `XMLHttpRequest`. `EventSource` n'existe pas
  dans React Native et les implémentations tierces imposent un module natif,
  donc une reconstruction de l'APK ; celle-ci n'ajoute **aucune dépendance** et
  sait poser l'en-tête `Authorization`, ce qu'`EventSource` ne fait pas.
  Reconnexion à attente croissante (2 s → 30 s).
- `src/providers/live-events-provider.tsx` — ouvre le flux, remonte les
  évènements en toast quel que soit l'écran, invalide les requêtes concernées,
  ferme le socket quand l'écran s'éteint. **Repli automatique sur le sondage**
  après 3 échecs consécutifs : un pare-feu qui casse les connexions longues ne
  doit pas rendre l'app aveugle.
- `src/config/tiers.ts` — `loadTiers()` lit le serveur, avec une copie hors
  ligne pour l'affichage seul. Elle ne sert **jamais** à facturer : le montant
  est calculé côté serveur à la demande d'activation.
- `src/lib/proAdvisor.ts` — le conseiller raisonne sur les **capacités** des
  formules (routeurs, accès distant, impression A4), jamais sur leurs noms : le
  super admin peut renommer, retarifer ou ajouter une formule sans que ce
  fichier bouge.
- `app/admin.tsx` — back-office en quatre sections : Aperçu, Demandes (avec
  compteur), Comptes/Utilisateurs, Formules.

## Tests

`src/modules/admin/admin.roles.spec.ts` — énumère les méthodes du contrôleur par
réflexion et vérifie que `MEMBER`, `ADMIN` et `OWNER` sont refusés sur
**chacune**, y compris celles ajoutées plus tard. Idem pour `/events/platform`.

Vérifié aussi de bout en bout contre une base réelle : 403 pour un `OWNER` sur
`/admin/*`, flux SSE livré, prix annuel calculé (15 000 −20 % → 12 000/mois →
144 000/an), facture figée après changement de tarif, reprise `lastEventId`
qui ne rejoue pas un évènement déjà vu.

## Déploiement

1. `npx prisma migrate deploy` sur le VPS (la migration ajoute des colonnes
   *nullables* et des index : pas de réécriture de table, pas de verrou long).
2. `npm run prisma:seed` — crée les trois formules aux **prix actuels**
   (5 000 / 15 000 / 35 000, remise 20 %). Sans ce seed,
   `/subscriptions/tiers` renvoie une liste vide et l'app retombe sur sa copie
   hors ligne ; `request-upgrade` répondrait 400 « Aucune formule payante n'est
   publiée ».
3. Vérifier que le reverse proxy **ne met pas en tampon** `/api/events/*`
   (`proxy_buffering off`, `proxy_read_timeout` généreux), sinon le SSE ne
   sort pas. ⚠️ La configuration nginx est hors périmètre de cet agent : à
   faire manuellement.
4. Rattacher les abonnements historiques à une formule : ils apparaissent dans
   `GET /admin/metrics` sous `revenue.untieredActive`.
