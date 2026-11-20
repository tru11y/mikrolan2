'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiGet, apiPost, extractErrorMessage } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { dateFr, xof } from '@/lib/format';

type BillingPeriod = 'MONTHLY' | 'ANNUAL';
type TierFeature = { label: string; included: boolean };

type Tier = {
  id: string;
  key: string;
  name: string;
  monthlyXof: number;
  annualMonthlyXof: number;
  annualDiscount: number;
  badge: string | null;
  tagline: string | null;
  features: TierFeature[];
  displayOrder: number;
  active: boolean;
};

type UpgradeRequestResult = {
  invoice: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    tierKey: string;
    tierName: string;
    billingPeriod: BillingPeriod;
  };
  instructions: string;
};

type InvoiceHistoryItem = {
  id: string;
  amount: number;
  currency: string;
  billingPeriod: BillingPeriod;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  tier: { name: string; key: string } | null;
};

const STATUS_TONE: Record<InvoiceHistoryItem['status'], 'success' | 'warning' | 'danger' | 'muted'> = {
  PAID: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
  REFUNDED: 'muted',
};
const STATUS_LABEL: Record<InvoiceHistoryItem['status'], string> = {
  PAID: 'Payée',
  PENDING: 'En attente',
  FAILED: 'Échouée',
  REFUNDED: 'Remboursée',
};

export default function AbonnementPage() {
  const [period, setPeriod] = useState<BillingPeriod>('MONTHLY');
  const [result, setResult] = useState<UpgradeRequestResult | null>(null);

  const tiers = useQuery({
    queryKey: ['subscriptions', 'tiers'],
    queryFn: () => apiGet<Tier[]>('/subscriptions/tiers'),
  });
  const invoices = useQuery({
    queryKey: ['subscriptions', 'invoices'],
    queryFn: () => apiGet<InvoiceHistoryItem[]>('/subscriptions/invoices'),
  });

  const upgrade = useMutation({
    mutationFn: (tierKey: string) =>
      apiPost<UpgradeRequestResult>('/subscriptions/request-upgrade', {
        tierKey,
        billingPeriod: period,
      }),
    onSuccess: (data) => {
      setResult(data);
      invoices.refetch();
    },
  });

  const list = (tiers.data ?? [])
    .filter((t) => t.active)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div>
      <PageHeader title="Mon abonnement" />

      <div className="mb-5 inline-flex rounded-xl border border-border bg-surface2 p-1">
        {(['MONTHLY', 'ANNUAL'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              period === p ? 'bg-primary text-white' : 'text-muted hover:text-fg'
            }`}
          >
            {p === 'MONTHLY' ? 'Mensuel' : 'Annuel'}
          </button>
        ))}
      </div>

      {upgrade.error && (
        <div className="mb-4">
          <ErrorBox message={extractErrorMessage(upgrade.error)} />
        </div>
      )}
      {result && (
        <Card className="mb-4 border-primary/40 bg-primary/10">
          <div className="font-semibold text-fg">
            Demande enregistrée — {result.invoice.tierName}
          </div>
          <div className="mt-1 text-sm text-muted">
            Facture {xof(result.invoice.amount)} ·{' '}
            {result.invoice.billingPeriod === 'ANNUAL' ? 'annuel' : 'mensuel'}
          </div>
          <p className="mt-2 whitespace-pre-line text-sm text-fg">{result.instructions}</p>
        </Card>
      )}

      {tiers.isLoading ? (
        <Loading />
      ) : tiers.error ? (
        <ErrorBox message={extractErrorMessage(tiers.error)} />
      ) : list.length === 0 ? (
        <EmptyState>Aucune formule disponible.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.map((tier) => {
            const monthly = period === 'ANNUAL' ? tier.annualMonthlyXof : tier.monthlyXof;
            return (
              <Card key={tier.id} className="flex flex-col">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold text-fg">{tier.name}</div>
                  {tier.badge && <Badge tone="primary">{tier.badge}</Badge>}
                </div>
                {tier.tagline && <div className="mt-1 text-sm text-muted">{tier.tagline}</div>}
                <div className="mt-4">
                  <span className="text-3xl font-extrabold text-fg">{xof(monthly)}</span>
                  <span className="text-sm text-muted"> / mois</span>
                </div>
                {period === 'ANNUAL' && tier.annualDiscount > 0 && (
                  <div className="mt-1 text-xs text-success">
                    -{tier.annualDiscount}% en paiement annuel
                  </div>
                )}
                <ul className="mt-4 flex-1 space-y-2 text-sm">
                  {tier.features.map((f, i) => (
                    <li
                      key={i}
                      className={`flex items-start gap-2 ${f.included ? 'text-fg' : 'text-muted line-through'}`}
                    >
                      <span className={f.included ? 'text-success' : 'text-muted'}>
                        {f.included ? '✓' : '×'}
                      </span>
                      {f.label}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-5 w-full"
                  loading={upgrade.isPending && upgrade.variables === tier.key}
                  disabled={upgrade.isPending}
                  onClick={() => upgrade.mutate(tier.key)}
                >
                  Demander
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold text-fg">Factures</h2>
      {invoices.isLoading ? (
        <Loading />
      ) : invoices.error ? (
        <ErrorBox message={extractErrorMessage(invoices.error)} />
      ) : (invoices.data ?? []).length === 0 ? (
        <EmptyState>Aucune facture pour le moment.</EmptyState>
      ) : (
        <div className="space-y-2">
          {(invoices.data ?? []).map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3"
            >
              <div>
                <div className="font-medium text-fg">
                  {inv.tier?.name ?? 'Abonnement'} · {xof(inv.amount)}
                </div>
                <div className="text-xs text-muted">
                  {inv.billingPeriod === 'ANNUAL' ? 'Annuel' : 'Mensuel'} ·{' '}
                  {dateFr(inv.paidAt ?? inv.createdAt)}
                </div>
              </div>
              <Badge tone={STATUS_TONE[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
