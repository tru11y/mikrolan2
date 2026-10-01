# Backlog produit / technique

## P0
- **TICKET GENERATION IDEMPOTENCY / SAFE RETRY** — `generateVouchers` n'a pas de clé d'idempotence : un retry après FAILED peut créer un lot en double. Le bouton « Réessayer » est retiré en attendant (FAILED → « Nouveau lot »).
- **Activation race 15-30 s** (nettoyage tickets P0-2B) — documenté, non traité.
- **RouterOS cleanup failure** (nettoyage tickets P0-2B) — documenté, non traité.

## P1
- **ENTITLEMENT SHOULD HONOR TIER CAPABILITIES** — `getEntitlement` décide via `plan === PRO && status === ACTIVE && currentPeriodEnd > now` et ignore `SubscriptionTier.remoteAccess`. Sans impact tant que essentiel/avance/entreprise ont `remoteAccess=true`.
- **Timezone du filtre Mois (Rapport)** — bornes envoyées en UTC ; vérifier le fuseau du tenant.

## Sécurité
- **JSON.parse fragment** — un `JSON.parse` sur des identifiants déchiffrés corrompus peut citer un fragment du secret dans le message d'erreur (donc dans Sentry). Marginal.
- **GET /routers/:id/credentials** — renvoie le mot de passe RouterOS en clair à un ADMIN+ (restauration LAN) ; à revoir si le LAN direct disparaît.

## CI
- **CI MOBILE JOB MUST RUN EXPO LINT** — le job « Mobile — Lint / Type-check » n'exécute que `tsc --noEmit`.
- **AdminAuditTab.tsx orphelin** — extrait tel quel de l'ancien `admin.tsx` (où `AuditTab` n'était déjà jamais rendu) ; non branché à l'onglet `audit`.
