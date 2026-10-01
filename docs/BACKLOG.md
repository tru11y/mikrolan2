# Backlog produit / technique

## P0
- **TICKET GENERATION IDEMPOTENCY / SAFE RETRY** — `generateVouchers` n'a pas de clé d'idempotence : un retry après FAILED peut créer un lot en double. Le bouton « Réessayer » est retiré en attendant (FAILED → « Nouveau lot »).
- **Activation race 15-30 s** (nettoyage tickets P0-2B) — documenté, non traité.
- **RouterOS cleanup failure** (nettoyage tickets P0-2B) — documenté, non traité.

## P1
- **ENTITLEMENT SHOULD HONOR TIER CAPABILITIES** — `getEntitlement` décide via `plan === PRO && status === ACTIVE && currentPeriodEnd > now` et ignore `SubscriptionTier.remoteAccess`. Sans impact tant que essentiel/avance/entreprise ont `remoteAccess=true`.
- **Timezone du filtre Mois (Rapport)** — bornes envoyées en UTC ; vérifier le fuseau du tenant.
