# Contrat sous-agents — web parité (NE PAS MODIFIER les fichiers partagés)

Front : Next.js 14 App Router, TS strict, Tailwind (dark, FR), React Query. API NestJS via `@/lib/api`.

## Règles absolues
- Créer UNIQUEMENT les fichiers sous les chemins assignés. **Ne modifier aucun fichier existant** (api.ts, types.ts, auth.tsx, ui.tsx, Sidebar.tsx, format.ts, layouts). Si un type manque, le définir LOCALEMENT dans ton dossier.
- Tous les écrans applicatifs vont sous `src/app/(app)/<feature>/...` (hérite du layout sidebar + guard auth).
- Labels UI en français. Dark mode (couleurs Tailwind: `bg, surface, surface2, border, primary, success, warning, danger, muted, fg`).
- Data fetching via React Query + helpers `apiGet/apiPost/apiPatch/apiDelete` de `@/lib/api`. Jamais d'appel direct fetch.
- Gestion erreur : `extractErrorMessage(err)` + composant `ErrorBox`. Loading : `Loading`. Vides : `EmptyState`.
- Primitives UI réutilisables : `@/components/ui` → `Card, Stat, Button, Input, Badge, Dot, Spinner, PageHeader, EmptyState, Loading, ErrorBox`.
- Format : `@/lib/format` → `xof(n)`, `dateFr(d)`, `bytes(n)`.
- TS strict : pas de `any`. Typer les réponses. `noUncheckedIndexedAccess` actif.
- Fin de tâche : `npx tsc --noEmit` doit passer pour tes fichiers.

## Enveloppe API
Toutes les réponses : `{ success, data, error }`. Les helpers renvoient déjà `data`. Auth = Bearer (géré par l'intercepteur). 401 → refresh auto.

## Endpoints disponibles (base = NEXT_PUBLIC_API_BASE_URL)
Auth: `/auth/login`,`/auth/signup`,`/auth/me`,`/auth/logout`,`/auth/password-reset/request`,`/auth/password-reset/confirm`,`/auth/change-password`,`/auth/google`,`/auth/apple`,`/auth/legal-consent`,`/auth/me/notifications`
Routeurs: `GET/POST /routers`, `GET/PATCH/DELETE /routers/:id`, `/routers/:id/credentials`, `/routers/:id/events`, `/routers/:id/remote`(+/activate,/provision,/reboot,/revoke,/cancel,/live,/system-resource,/open-access), `/routers/:id/sessions`(+/sync,/terminate), `/routers/:id/ticket-template`
Hotspot: `/routers/:id/hotspot/`(configure,settings,servers,user-profiles,ip-bindings,internet-sharing)
Vouchers: `/routers/:id/vouchers`(+/generate,/confirm,/search,/lookup,/cleanup,/batches,/:vid/revoke,/:vid/reprint)
Forfaits: `GET/POST /routers/:routerId/plans`, `PATCH/DELETE /routers/:routerId/plans/:planId`
Metrics: `GET /metrics/summary?period=today|yesterday|7d|30d`, `GET /metrics/clients?routerId=&limit=`
Analytics: `/analytics/overview`,`/analytics/sessions`,`/analytics/routers`,`/analytics/plans`,`/analytics/traffic`,`/analytics/insights`,`/analytics/forecast`(+/routers,/plans,/traffic), `/analytics/routers/:routerId`
Notifications: `GET /notifications`, `/notifications/unread-count`, `/notifications/:id/read`, `/notifications/read-all`
Abonnement: `/subscriptions/tiers`,`/subscriptions/invoices`,`/subscriptions/request-upgrade`; Paiement: `/payments/saspay/checkout`,`/payments/saspay/intents/:id`
Support: `GET/POST /support/tickets`, `/support/tickets/:id`(+/messages), `/support/contact`
Vérificateurs: `GET/POST /ticket-verifiers`, `/ticket-verifiers/:id`(+/status,/assignment,/reset-password); vérif: `/ticket-verification/verify`, `/vouchers/verify`
Admin (SUPER_ADMIN): `/admin/tenants`(+/:id,/:id/status,/:id/subscription,/:id/routers...), `/admin/tiers`(+/:id), `/admin/invoices`(+/:id/proofs), `/admin/tickets`(+/:id,/:id/messages,/:id/status), `/admin/users`(+/:id/status), `/admin/fleet`, `/admin/metrics`, `/admin/revenue-history`, `/admin/audit`, `/admin/billing-audit`, `/admin/wireguard/peers`(+/:routerId/resync,/revoke)
Remote-access (autorisation CGV): `/remote-access/authorization`(+/accept,/revoke)
Legal: `/legal/versions`

## Types partagés
Importer depuis `@/lib/types` (Me, UserRole, RouterSummary, RouterHealth, ManagementMode, MetricsSummary, RecentClient, Plan, Voucher, VoucherStatus, SessionRow, NotificationRow, Paginated). Compléter localement si besoin (ne pas éditer types.ts).

## Rôles
`SUPER_ADMIN` (plateforme), `ADMIN` (tenant), `MEMBER` (lecture), `TICKET_VERIFIER`. `useAuth().me.role` pour conditionner l'UI.
