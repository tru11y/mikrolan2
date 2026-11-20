'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiGet, apiPost, extractErrorMessage } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { dateFr, xof } from '@/lib/format';

type BillingPeriod = 'MONTHLY' | 'ANNUAL';

type Tier = {
  id: string;
  key: string;
  name: string;
  monthlyXof: number;
  annualMonthlyXof: number;
  displayOrder: number;
  active: boolean;
};

type CheckoutResult = {
  intentId: string;
  checkoutUrl: string;
  invoiceId: string;
  amount: number;
};

type IntentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
type PaymentIntent = {
  id: string;
  status: IntentStatus;
  activatedAt: string | null;
  amountRequested: number;
  amountCharged: number | null;
  amountNet: number | null;
  currency: string;
  createdAt: string;
};

const INTENT_TONE: Record<IntentStatus, 'success' | 'warning' | 'danger' | 'muted'> = {
  SUCCESS: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
  CANCELLED: 'danger',
  EXPIRED: 'muted',
};
const INTENT_LABEL: Record<IntentStatus, string> = {
  SUCCESS: 'Payé',
  PENDING: 'En attente',
  FAILED: 'Échoué',
  CANCELLED: 'Annulé',
  EXPIRED: 'Expiré',
};

export default function PaiementsPage() {
  const [period, setPeriod] = useState<BillingPeriod>('MONTHLY');
  const [tierKey, setTierKey] = useState<string>('');
  const [intentId, setIntentId] = useState<string | null>(null);

  const tiers = useQuery({
    queryKey: ['subscriptions', 'tiers'],
    queryFn: () => apiGet<Tier[]>('/subscriptions/tiers'),
  });

  const checkout = useMutation({
    mutationFn: (key: string) =>
      apiPost<CheckoutResult>('/payments/saspay/checkout', { tierKey: key, billingPeriod: period }),
    onSuccess: (data) => {
      setIntentId(data.intentId);
      window.open(data.checkoutUrl, '_blank', 'noopener,noreferrer');
    },
  });

  const intent = useQuery({
    queryKey: ['payments', 'saspay', 'intent', intentId],
    queryFn: () => apiGet<PaymentIntent>(`/payments/saspay/intents/${intentId}`),
    enabled: intentId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && status !== 'PENDING' ? false : 4000;
    },
  });

  const list = (tiers.data ?? [])
    .filter((t) => t.active)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div>
      <PageHeader title="Paiements" />

      <Card className="mb-6">
        <h2 className="mb-1 text-lg font-semibold text-fg">Payer par SasPay</h2>
        <p className="mb-4 text-sm text-muted">
          Réglez votre abonnement via Wave ou Orange Money. Le paiement s&apos;ouvre dans un nouvel
          onglet, puis le statut se met à jour ici automatiquement.
        </p>

        <div className="mb-4 inline-flex rounded-xl border border-border bg-surface2 p-1">
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

        {tiers.isLoading ? (
          <Loading />
        ) : tiers.error ? (
          <ErrorBox message={extractErrorMessage(tiers.error)} />
        ) : list.length === 0 ? (
          <EmptyState>Aucune formule disponible.</EmptyState>
        ) : (
          <div className="space-y-2">
            {list.map((tier) => {
              const amount = period === 'ANNUAL' ? tier.annualMonthlyXof : tier.monthlyXof;
              const selected = tierKey === tier.key;
              return (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() => setTierKey(tier.key)}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                    selected ? 'border-primary bg-primary/10' : 'border-border bg-surface hover:bg-surface2'
                  }`}
                >
                  <span className="font-medium text-fg">{tier.name}</span>
                  <span className="text-sm text-muted">
                    {xof(amount)} / mois
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {checkout.error && (
          <div className="mt-4">
            <ErrorBox message={extractErrorMessage(checkout.error)} />
          </div>
        )}

        <Button
          className="mt-4"
          disabled={!tierKey}
          loading={checkout.isPending}
          onClick={() => tierKey && checkout.mutate(tierKey)}
        >
          Payer maintenant
        </Button>
      </Card>

      {intentId && (
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-fg">Suivi du paiement</h2>
            {intent.data && <Badge tone={INTENT_TONE[intent.data.status]}>{INTENT_LABEL[intent.data.status]}</Badge>}
          </div>
          {intent.isLoading ? (
            <div className="mt-3">
              <Loading />
            </div>
          ) : intent.error ? (
            <div className="mt-3">
              <ErrorBox message={extractErrorMessage(intent.error)} />
            </div>
          ) : intent.data ? (
            <dl className="mt-4 space-y-1 text-sm">
              <Row label="Montant demandé" value={xof(intent.data.amountRequested)} />
              {intent.data.amountCharged != null && (
                <Row label="Montant débité" value={xof(intent.data.amountCharged)} />
              )}
              <Row label="Créé le" value={dateFr(intent.data.createdAt)} />
              {intent.data.activatedAt && (
                <Row label="Activé le" value={dateFr(intent.data.activatedAt)} />
              )}
              {intent.data.status === 'PENDING' && (
                <p className="pt-2 text-xs text-muted">
                  En attente de confirmation… Finalisez le paiement dans l&apos;onglet ouvert.
                </p>
              )}
            </dl>
          ) : null}
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-fg">{value}</dd>
    </div>
  );
}
