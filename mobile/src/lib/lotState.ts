import type { VoucherBatch } from './api';

export type LotState = 'generating' | 'completed' | 'partial' | 'failed' | 'empty';

/**
 * État d'un lot d'après les compteurs réels (jamais `batch.generated`, un compteur
 * de workflow historique) : seuls les tickets `provisioned` sont distribuables.
 */
export function lotState(b: Pick<VoucherBatch, 'status' | 'quantity' | 'voucherCount' | 'provisionedCount'>): { state: LotState; available: number; missing: number } {
  const available = b.provisionedCount;
  if (b.status === 'PENDING' || b.status === 'GENERATING') return { state: 'generating', available, missing: 0 };
  const missing = Math.max(
    b.voucherCount - b.provisionedCount,
    b.status === 'PARTIAL_SUCCESS' ? b.quantity - b.provisionedCount : 0,
  );
  if (available === 0) {
    // Tous les tickets supprimés (nettoyage) sur un lot réussi : pas un échec.
    const emptied = b.voucherCount === 0 && b.status !== 'FAILED';
    return { state: emptied ? 'empty' : 'failed', available, missing: b.quantity };
  }
  return { state: missing > 0 ? 'partial' : 'completed', available, missing };
}

export function plural(
  t: (key: string, opts?: Record<string, unknown>) => string,
  key: string,
  count: number,
  extra: Record<string, unknown> = {},
): string {
  return t(count > 1 ? key : `${key}One`, { count, ...extra });
}
