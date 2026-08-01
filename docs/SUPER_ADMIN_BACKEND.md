# Back-office super admin — contrat serveur à implémenter

État au 2026-08-01. Le travail décrit ici **n'est pas fait** : l'application
mobile est prête à le consommer, le backend NestJS ne l'expose pas encore.

## Ce qui existe déjà

| Élément | Où |
|---|---|
| Rôle `SUPER_ADMIN` | `prisma/schema.prisma` → `enum UserRole` |
| Bypass d'isolation tenant | `src/prisma/prisma.service.ts:60` |
| Bypass d'entitlement | `src/common/guards/entitlement.guard.ts:46` |
| Hiérarchie de rôles | `src/common/guards/roles.guard.ts:17` |
| Activation manuelle d'un abonnement | `POST /subscriptions/:tenantId/activate` |
| Désactivation | `POST /subscriptions/:tenantId/deactivate` |

L'écran `mobile/app/admin.tsx` consomme aujourd'hui **uniquement** ces deux
routes. Tout le reste ci-dessous est manquant.

## Ce qui manque

### 1. Formules d'abonnement pilotées par le super admin

Aujourd'hui les prix sont écrits en dur à deux endroits qui ne se parlent pas :

- `mobile/src/config/tiers.ts` — la grille affichée au client (5 000 / 15 000 /
  35 000 XOF) ;
- `backend/src/modules/subscriptions/subscriptions.service.ts:15` —
  `PRO_MONTHLY_XOF = 15000`, le montant réellement facturé.

Changer un prix impose donc de publier un APK, et les deux valeurs peuvent
diverger sans que rien ne le signale.

**Modèle Prisma proposé :**

```prisma
model SubscriptionTier {
  id              String   @id @default(uuid())
  key             String   @unique   // essentiel | avance | entreprise
  name            String
  monthlyXof      Int
  annualDiscount  Int      @default(20) // en %
  routerLimit     Int?                  // null = illimité
  remoteAccess    Boolean  @default(false)
  a4Printing      Boolean  @default(false)
  cloudBackup     Boolean  @default(false)
  prioritySupport Boolean  @default(false)
  badge           String?
  features        Json                  // [{ label, included }]
  displayOrder    Int      @default(0)
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

**Routes :**

| Méthode | Chemin | Rôle | Rôle métier |
|---|---|---|---|
| `GET` | `/subscriptions/tiers` | `@Public` / authentifié | grille lue par l'app cliente |
| `POST` | `/admin/tiers` | `SUPER_ADMIN` | créer une formule |
| `PATCH` | `/admin/tiers/:id` | `SUPER_ADMIN` | changer nom, prix, limites |
| `DELETE` | `/admin/tiers/:id` | `SUPER_ADMIN` | archiver (soft delete) |

Côté mobile, seul le corps de `loadTiers()` (`src/config/tiers.ts`) change :
appel réseau, repli sur la constante locale si le serveur est injoignable.
`Invoice.amount` doit être calculé à partir du tier, plus de `PRO_MONTHLY_XOF`.

> Règle : un changement de prix ne modifie **jamais** rétroactivement une
> `Invoice` déjà émise. Copier le montant dans l'invoice à la création.

### 2. Liste des comptes et des utilisateurs

Aucune route ne permet aujourd'hui de savoir qui utilise la plateforme.

| Méthode | Chemin | Retour |
|---|---|---|
| `GET` | `/admin/tenants?status=&q=&cursor=` | pagination curseur : `id, name, slug, status, plan, tier, routerCount, userCount, createdAt, lastActivityAt` |
| `GET` | `/admin/tenants/:id` | détail + abonnement + routeurs + dernières factures |
| `GET` | `/admin/users?tenantId=&q=&cursor=` | `id, email, name, role, status, tenantName, lastLoginAt` |
| `PATCH` | `/admin/users/:id/status` | suspendre / réactiver (jamais de suppression dure) |
| `PATCH` | `/admin/tenants/:id/status` | `ACTIVE` / `SUSPENDED` |

Contraintes :

- pagination **curseur** (`createdAt, id`), pas `offset` — la liste grandit ;
- index requis : `User.email` existe déjà ; ajouter `Tenant.createdAt` et
  `User(tenantId, createdAt)` ;
- ces routes traversent l'isolation tenant : elles doivent être marquées
  explicitement et couvertes par un test qui vérifie qu'un `OWNER` reçoit 403.

### 3. Demandes d'activation en attente

`requestUpgrade` crée une `Invoice` `PENDING` mais rien ne permet de les lister.
C'est la file de travail quotidienne du super admin.

| Méthode | Chemin | Retour |
|---|---|---|
| `GET` | `/admin/invoices?status=PENDING` | `id, tenantId, tenantName, amount, createdAt, note` |

⚠️ La note du client (résumé du conseiller, cf. `src/lib/proAdvisor.ts`) est
aujourd'hui rangée dans `AuditLog.metadata.note` et non sur l'`Invoice` : la
remonter dans la réponse, ou ajouter `Invoice.note String?`.

### 4. Chiffres de la plateforme

| Méthode | Chemin | Retour |
|---|---|---|
| `GET` | `/admin/metrics` | comptes actifs / en essai / verrouillés, MRR, essais expirant sous 7 jours, routeurs en ligne, tickets vendus sur 30 j |

Le MRR se calcule depuis les `Subscription` actives × prix du tier, pas depuis
les `Invoice` (qui incluent l'annuel).

### 5. Journal d'audit consultable

`AuditLog` est alimenté mais jamais lu.

| Méthode | Chemin |
|---|---|
| `GET` | `/admin/audit?tenantId=&action=&cursor=` |

Append-only : aucune route d'écriture ou de suppression.

### 6. Temps réel

Le suivi « en direct » de l'application est un sondage toutes les 5 s
(`mobile/src/providers/live-events-provider.tsx`). C'est un pis-aller : à
100 comptes actifs cela fait 20 requêtes/seconde pour des évènements rares.

**Cible :** `GET /notifications/stream` en SSE (`@Sse` de NestJS, déjà
disponible ; Fastify le supporte via `fastify-sse-v2`).

- un flux par tenant, filtré par le `TenantContext` du JWT ;
- `Last-Event-ID` pour rattraper ce qui a été manqué hors ligne ;
- heartbeat toutes les 20 s (les proxys coupent les connexions inactives) ;
- côté mobile : seul le corps de `LiveEventsProvider` change, les écrans
  consomment déjà `useLiveEvents()`.

**Évènements à publier :**

| Type | Déclencheur | Existe ? |
|---|---|---|
| `VOUCHER_ACTIVATED` | un ticket se connecte (`sessions.service.ts:132`) | ✅ créé, non poussé |
| `SESSION_ENDED` | fin de session hotspot | ❌ |
| `SUBSCRIPTION_ACTIVATED` | le super admin valide un paiement | ❌ |
| `UPGRADE_REQUESTED` | un client demande PRO (à destination du super admin) | ❌ |
| `ROUTER_OFFLINE` | heartbeat manqué | ❌ |

Ajouter les valeurs correspondantes à `enum NotificationType`.

## Ordre d'implémentation conseillé

1. `GET /admin/invoices?status=PENDING` — débloque le quotidien du super admin ;
2. `SubscriptionTier` + CRUD — supprime les prix en dur des deux côtés ;
3. `GET /admin/tenants` + `/admin/users` — visibilité sur le parc ;
4. SSE — remplace le sondage ;
5. `/admin/metrics` et `/admin/audit`.

## Points de vigilance

- **Isolation.** Le middleware Prisma (`prisma.service.ts:60`) laisse passer
  `SUPER_ADMIN` sans filtre `tenantId`. Chaque nouvelle route admin doit avoir
  un test qui vérifie le 403 pour `OWNER`, `ADMIN` et `MEMBER`.
- **Rate limiting.** Les routes admin listent des données sensibles :
  Throttler strict, et pas d'énumération d'e-mails via `?q=`.
- **Audit.** Toute action admin (activation, suspension, changement de prix)
  écrit une `AuditLog`. Le service d'audit ne doit jamais lever.
- **Migration.** L'ajout de `SubscriptionTier` nécessite un seed des trois
  formules actuelles avec exactement les prix de `mobile/src/config/tiers.ts`,
  faute de quoi les clients verront les prix changer au déploiement.
