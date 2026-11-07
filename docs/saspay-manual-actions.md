# Actions manuelles de paiement vs SasPay

Branche `fix/block-manual-saspay-actions`. Le webhook SasPay est la seule source d'activation d'une facture `provider=SASPAY`.

## Contrats HTTP

| Route | Avant | Après |
|---|---|---|
| `POST /api/admin/invoices/:id/validate` (SASPAY, tout statut) | 200 si PENDING, 400 sinon | **409** `SASPAY_INVOICE_MANAGED_BY_WEBHOOK` |
| `POST /api/admin/invoices/:id/reject` (SASPAY, tout statut) | 200 si PENDING, 400 sinon | **409** `SASPAY_INVOICE_MANAGED_BY_WEBHOOK` |
| `POST /api/subscriptions/upload-proof` | 200 (fichier + `PaymentProof` + audit `UPLOAD`) | **410** `MANUAL_PAYMENT_PROOF_DISABLED`, aucune écriture |
| `POST /api/subscriptions/:tenantId/activate` | active toujours | **409** `SASPAY_PAYMENT_CONFIRMATION_REQUIRED` si facture SASPAY PENDING du tenant, ou `invoiceId` SASPAY |
| `GET /api/admin/invoices`, `GET /api/admin/tenants/:id` | pas de `provider` | `provider: MANUAL \| SASPAY` |

Inchangés : lecture des preuves historiques (`GET /subscriptions/proofs/:proofId`, `GET /admin/invoices/:id/proofs`), table `PaymentProof`, fichiers, purge de conformité 730 jours, checkout/webhook SasPay.

## Décision : factures MANUAL historiques

`validate`/`reject` restent autorisés pour `provider=MANUAL` (SUPER_ADMIN). Aucune facture MANUAL PENDING en production à ce jour ; plus aucun chemin ne peut en créer de nouvelle avec preuve, mais `request-upgrade` crée encore des factures MANUAL PENDING (à traiter dans un chantier séparé si on veut fermer ce chemin).

## `POST /subscriptions/:tenantId/activate`

- Rôle : SUPER_ADMIN uniquement (`@Roles`), aucun appel depuis le mobile après PR #115.
- Appelants : ancien écran admin mobile (`AdminRequestsTab`, retiré par #115). Le webhook SasPay et `AdminService.validateInvoice` appellent `SubscriptionsService.activate()` directement, sans passer par cette route.
- Cas légitime restant : activation manuelle d'un tenant sans facture SASPAY PENDING (geste commercial, facture MANUAL historique).
- Garde dans `SubscriptionsService.activateManually()` ; `activate()` reste non gardé (utilisé par le webhook).
