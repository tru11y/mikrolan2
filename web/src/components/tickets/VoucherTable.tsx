'use client';

import { Badge, Button, EmptyState } from '@/components/ui';
import { xof, dateFr } from '@/lib/format';
import {
  durationLabel,
  VOUCHER_STATUS_LABELS,
  VOUCHER_STATUS_TONES,
  type VoucherSearchItem,
} from './types';

export function VoucherTable({
  items,
  onRevoke,
  onReprint,
  pendingId,
  pendingAction,
}: {
  items: VoucherSearchItem[];
  onRevoke: (v: VoucherSearchItem) => void;
  onReprint: (v: VoucherSearchItem) => void;
  pendingId: string | null;
  pendingAction: 'revoke' | 'reprint' | null;
}) {
  if (items.length === 0) {
    return <EmptyState>Aucun ticket pour ce filtre.</EmptyState>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-4 py-3 font-medium">Code</th>
            <th className="px-4 py-3 font-medium">Forfait</th>
            <th className="px-4 py-3 font-medium">Statut</th>
            <th className="px-4 py-3 font-medium">Créé le</th>
            <th className="px-4 py-3 font-medium">Utilisé le</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((v) => {
            const canRevoke = v.status === 'GENERATED' || v.status === 'ACTIVE';
            const busyRevoke = pendingId === v.id && pendingAction === 'revoke';
            const busyReprint = pendingId === v.id && pendingAction === 'reprint';
            return (
              <tr key={v.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-mono font-semibold text-fg">{v.code}</td>
                <td className="px-4 py-3 text-muted">
                  <div className="text-fg">{v.plan.name}</div>
                  <div className="text-xs text-muted">
                    {xof(v.plan.priceXof)} · {durationLabel(v.plan.durationMinutes)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={VOUCHER_STATUS_TONES[v.status]}>
                    {VOUCHER_STATUS_LABELS[v.status]}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted">{dateFr(v.createdAt)}</td>
                <td className="px-4 py-3 text-muted">{v.usedAt ? dateFr(v.usedAt) : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      className="px-3 py-1.5 text-xs"
                      loading={busyReprint}
                      onClick={() => onReprint(v)}
                    >
                      Réimprimer
                    </Button>
                    <Button
                      variant="danger"
                      className="px-3 py-1.5 text-xs"
                      disabled={!canRevoke}
                      loading={busyRevoke}
                      onClick={() => onRevoke(v)}
                    >
                      Révoquer
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
