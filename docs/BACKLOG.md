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

## P2
- **TICKET ACTION BUTTON RESPONSIVE LAYOUT** — sur l'écran Fichiers, « Révoquer » et « Supprimer » passent sur deux lignes (« Révoque/r », « Supprim/er ») dans la rangée d'actions d'un ticket. Non bloquant RC.
- **VOUCHER DURATION SNAPSHOT** — « Vérifier un ticket » calcule `expiresAt = usedAt + Plan.durationMinutes` avec la durée ACTUELLE du forfait. Un ticket généré avec un forfait de 24 h puis dont le forfait est édité à 48 h afficherait 48 h. Cible : snapshot de la durée sur le voucher à la génération.
- **CALENDAR EXPIRATION VS ROUTEROS LIMIT-UPTIME** — l'expiration affichée est calendaire (`usedAt + durée`) alors que `limit-uptime` RouterOS compte le temps de connexion cumulé. Décision produit connue pour cette version, non corrigée.
