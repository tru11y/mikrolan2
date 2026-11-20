'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, extractErrorMessage } from '@/lib/api';
import { xof } from '@/lib/format';
import { Button, Card, EmptyState, ErrorBox, Input, Loading } from '@/components/ui';
import {
  Select,
  VoucherStatusBadge,
  type GenerateResult,
  type RouterPlan,
  type VoucherReprint,
  type VoucherSearchItem,
  type VoucherSearchPage,
} from '@/components/routeurs/shared';

const PAGE = 30;

export default function RouterTicketsPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [planId, setPlanId] = useState('');
  const [quantity, setQuantity] = useState('10');
  const [reprint, setReprint] = useState<VoucherReprint | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const plans = useQuery({
    queryKey: ['plans', id],
    queryFn: () => apiGet<RouterPlan[]>(`/routers/${id}/plans`),
    enabled: Boolean(id),
  });

  const vouchers = useQuery({
    queryKey: ['voucher-search', id, query],
    queryFn: () =>
      apiGet<VoucherSearchPage>(`/routers/${id}/vouchers/search`, {
        q: query || undefined,
        limit: PAGE,
      }),
    enabled: Boolean(id),
  });

  const generate = useMutation({
    mutationFn: () =>
      apiPost<GenerateResult>(`/routers/${id}/vouchers/generate`, {
        planId,
        quantity: Number.parseInt(quantity, 10) || 1,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['voucher-search', id] });
      await qc.invalidateQueries({ queryKey: ['batches', id] });
    },
    onError: (e) => setActionError(extractErrorMessage(e)),
  });

  const revoke = useMutation({
    mutationFn: (vid: string) =>
      apiPost<{ revoked: boolean }>(`/routers/${id}/vouchers/${vid}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voucher-search', id] }),
    onError: (e) => setActionError(extractErrorMessage(e)),
  });

  const doReprint = useMutation({
    mutationFn: (vid: string) =>
      apiPost<VoucherReprint>(`/routers/${id}/vouchers/${vid}/reprint`),
    onSuccess: (data) => setReprint(data),
    onError: (e) => setActionError(extractErrorMessage(e)),
  });

  const items: VoucherSearchItem[] = vouchers.data?.items ?? [];
  const selectedPlan = plans.data?.find((p) => p.id === planId) ?? null;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-lg font-semibold">Générer des tickets</h2>
        <Card className="space-y-4">
          {generate.data && (
            <div className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
              Lot #{generate.data.batchSeq} : {generate.data.pushedCount}/{generate.data.totalCount}{' '}
              ticket(s) disponible(s).
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
            <Select label="Forfait" value={planId} onChange={setPlanId}>
              <option value="">— Choisir —</option>
              {(plans.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({xof(p.priceXof)})
                </option>
              ))}
            </Select>
            <Input
              label="Quantité"
              inputMode="numeric"
              value={quantity}
              onChange={(e) =>
                setQuantity(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))
              }
            />
          </div>
          {selectedPlan && (
            <div className="text-sm text-muted">
              Valeur du lot :{' '}
              <span className="font-semibold text-fg">
                {xof(selectedPlan.priceXof * (Number.parseInt(quantity, 10) || 0))}
              </span>
            </div>
          )}
          <Button
            onClick={() => {
              setActionError(null);
              generate.mutate();
            }}
            loading={generate.isPending}
            disabled={!planId || (Number.parseInt(quantity, 10) || 0) < 1}
          >
            Générer
          </Button>
        </Card>
      </section>

      {reprint && (
        <Card className="space-y-2 border-primary/40">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-fg">Réimpression</span>
            <button className="text-sm text-muted hover:text-fg" onClick={() => setReprint(null)}>
              Fermer
            </button>
          </div>
          <div className="font-mono text-lg tracking-wider text-fg">{reprint.code}</div>
          <div className="text-sm text-muted">
            Mot de passe : <span className="font-mono text-fg">{reprint.password}</span>
          </div>
          <div className="text-xs text-muted">
            {reprint.plan.name} · {xof(reprint.plan.priceXof)}
          </div>
        </Card>
      )}

      {actionError && <ErrorBox message={actionError} />}

      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-semibold">Tickets</h2>
        </div>
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
        >
          <div className="flex-1">
            <Input
              placeholder="Rechercher par code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoCapitalize="none"
            />
          </div>
          <Button type="submit" variant="ghost">
            Rechercher
          </Button>
        </form>

        {vouchers.isLoading ? (
          <Loading />
        ) : vouchers.error ? (
          <ErrorBox message={extractErrorMessage(vouchers.error)} />
        ) : items.length === 0 ? (
          <EmptyState>Aucun ticket trouvé.</EmptyState>
        ) : (
          <div className="space-y-2">
            {items.map((v) => (
              <Card key={v.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-base tracking-wider text-fg">{v.code}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {v.plan.name} · {xof(v.plan.priceXof)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <VoucherStatusBadge status={v.status} />
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setActionError(null);
                      doReprint.mutate(v.id);
                    }}
                    loading={doReprint.isPending && doReprint.variables === v.id}
                    disabled={v.status === 'REVOKED'}
                  >
                    Réimprimer
                  </Button>
                  {v.status !== 'REVOKED' && v.status !== 'ACTIVE' && (
                    <Button
                      variant="danger"
                      onClick={() => {
                        setActionError(null);
                        revoke.mutate(v.id);
                      }}
                      loading={revoke.isPending && revoke.variables === v.id}
                    >
                      Révoquer
                    </Button>
                  )}
                </div>
              </Card>
            ))}
            {vouchers.data?.nextCursor && (
              <p className="pt-2 text-center text-xs text-muted">
                Affinez la recherche pour voir plus de résultats.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
