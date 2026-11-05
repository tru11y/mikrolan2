// Libellé d'état d'une facture d'abonnement pour les écrans d'administration.
//
// Le seul flux officiel est : checkout SasPay → paiement → webhook signé → activation automatique.
// Aucune validation ni activation manuelle n'est proposée depuis l'app.
//
// Le backend n'envoie PAS encore `provider` aux écrans d'administration (GET /admin/invoices et
// fiche tenant). Tant qu'il est absent on reste neutre : on n'affirme « SasPay » que si le provider
// est explicitement connu.
export type InvoiceProvider = 'MANUAL' | 'SASPAY';

export type InvoicePaymentKey =
  | 'saspayPending'
  | 'saspayPaid'
  | 'saspayFailed'
  | 'manualHistory'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'other';

export function invoicePaymentKey(provider: string | null | undefined, status: string): InvoicePaymentKey {
  if (provider === 'SASPAY') {
    if (status === 'PENDING') return 'saspayPending';
    if (status === 'PAID') return 'saspayPaid';
    if (status === 'FAILED') return 'saspayFailed';
    return 'other';
  }
  // Anciennes factures du flux manuel abandonné : historique en lecture seule.
  if (provider === 'MANUAL') return 'manualHistory';
  if (status === 'PENDING') return 'pending';
  if (status === 'PAID') return 'paid';
  if (status === 'FAILED') return 'failed';
  return 'other';
}
