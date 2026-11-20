'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, extractErrorMessage } from '@/lib/api';
import type { VoucherStatus } from '@/lib/types';
import { Button, ErrorBox, Input, Loading, PageHeader } from '@/components/ui';
import { RouterPicker } from '@/components/tickets/RouterPicker';
import { VoucherTable } from '@/components/tickets/VoucherTable';
import { GenerateDialog } from '@/components/tickets/GenerateDialog';
import { Modal } from '@/components/tickets/Modal';
import {
  VOUCHER_STATUS_LABELS,
  type PlanFull,
  type VoucherReprint,
  type VoucherSearchItem,
  type VoucherSearchPage,
} from '@/components/tickets/types';

const STATUS_OPTIONS: (VoucherStatus | 'ALL')[] = [
  'ALL',
  'GENERATED',
  'ACTIVE',
  'USED',
  'EXPIRED',
  'REVOKED',
];

export default function TicketsPage() {
  const qc = useQueryClient();
  const [routerId, setRouterId] = useState<string | null>(null);
  const [status, setStatus] = useState<VoucherStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [reprint, setReprint] = useState<VoucherReprint | null>(null);
  const [pending, setPending] = useState<{ id: string; action: 'revoke' | 'reprint' } | null>(null);

  const vouchers = useQuery({
    queryKey: ['vouchers', routerId, status, query],
    queryFn: () =>
      apiGet<VoucherSearchPage>(`/routers/${routerId}/vouchers/search`, {
        ...(query ? { q: query } : {}),
        ...(status !== 'ALL' ? { status } : {}),
        limit: 50,
      }),
    enabled: Boolean(routerId),
  });

  const plans = useQuery({
    queryKey: ['plans', routerId],
    queryFn: () => apiGet<PlanFull[]>(`/routers/${routerId}/plans`),
    enabled: Boolean(routerId),
  });

  const revokeMutation = useMutation({
    mutationFn: (v: VoucherSearchItem) =>
      apiPost<{ revoked: boolean }>(`/routers/${routerId}/vouchers/${v.id}/revoke`),
    onMutate: (v) => setPending({ id: v.id, action: 'revoke' }),
    onSettled: () => setPending(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vouchers', routerId] }),
  });

  const reprintMutation = useMutation({
    mutationFn: (v: VoucherSearchItem) =>
      apiPost<VoucherReprint>(`/routers/${routerId}/vouchers/${v.id}/reprint`),
    onMutate: (v) => setPending({ id: v.id, action: 'reprint' }),
    onSettled: () => setPending(null),
    onSuccess: (data) => setReprint(data),
  });

  const actionError = revokeMutation.error ?? reprintMutation.error;
  const plansList = plans.data ?? [];

  return (
    <div>
      <PageHeader
        title="Tickets"
        action={
          <Button disabled={!routerId || plansList.length === 0} onClick={() => setShowGenerate(true)}>
            Générer des tickets
          </Button>
        }
      />

      <RouterPicker value={routerId} onChange={setRouterId} />

      {routerId && (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((s) => {
                const active = s === status;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'border-primary bg-primary/15 text-fg'
                        : 'border-border bg-surface text-muted hover:bg-surface2'
                    }`}
                  >
                    {s === 'ALL' ? 'Tous' : VOUCHER_STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(search.trim());
              }}
            >
              <Input
                placeholder="Rechercher un code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button type="submit" variant="ghost">
                Rechercher
              </Button>
            </form>
          </div>

          {actionError && (
            <div className="mb-4">
              <ErrorBox message={extractErrorMessage(actionError)} />
            </div>
          )}

          {vouchers.isLoading ? (
            <Loading />
          ) : vouchers.error ? (
            <ErrorBox message={extractErrorMessage(vouchers.error)} />
          ) : (
            <VoucherTable
              items={vouchers.data?.items ?? []}
              pendingId={pending?.id ?? null}
              pendingAction={pending?.action ?? null}
              onRevoke={(v) => revokeMutation.mutate(v)}
              onReprint={(v) => reprintMutation.mutate(v)}
            />
          )}
        </>
      )}

      {showGenerate && routerId && (
        <GenerateDialog
          routerId={routerId}
          plans={plansList}
          onClose={() => setShowGenerate(false)}
          onGenerated={() => qc.invalidateQueries({ queryKey: ['vouchers', routerId] })}
        />
      )}

      {reprint && (
        <Modal title="Réimpression du ticket" onClose={() => setReprint(null)}>
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-border bg-surface2 p-4 text-center">
              <div className="font-mono text-2xl font-bold text-fg">{reprint.code}</div>
              {reprint.password && reprint.password !== reprint.code && (
                <div className="mt-1 font-mono text-muted">Mot de passe : {reprint.password}</div>
              )}
            </div>
            <div className="text-muted">
              {reprint.plan.name} · {reprint.plan.priceXof.toLocaleString('fr-FR')} FCFA
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setReprint(null)}>Fermer</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
