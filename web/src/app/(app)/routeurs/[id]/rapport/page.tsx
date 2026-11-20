'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiGet, extractErrorMessage } from '@/lib/api';
import { xof, dateFr } from '@/lib/format';
import { Card, Dot, EmptyState, ErrorBox, Loading, Stat } from '@/components/ui';
import { Select, type MetricsSummaryX, type RecentClientX } from '@/components/routeurs/shared';

type Period = 'today' | 'yesterday' | '7d' | '30d';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: "Aujourd'hui" },
  { value: 'yesterday', label: 'Hier' },
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
];

export default function RouterRapportPage() {
  const { id } = useParams<{ id: string }>();
  const [period, setPeriod] = useState<Period>('7d');

  const summary = useQuery({
    queryKey: ['metrics', 'summary', period, id],
    queryFn: () => apiGet<MetricsSummaryX>('/metrics/summary', { period, routerId: id }),
    enabled: Boolean(id),
  });
  const clients = useQuery({
    queryKey: ['metrics', 'clients', id],
    queryFn: () => apiGet<RecentClientX[]>('/metrics/clients', { routerId: id, limit: 30 }),
    enabled: Boolean(id),
  });

  const s = summary.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Rapport</h2>
        <div className="w-40">
          <Select value={period} onChange={(v) => setPeriod(v as Period)}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {summary.isLoading ? (
        <Loading />
      ) : summary.error ? (
        <ErrorBox message={extractErrorMessage(summary.error)} />
      ) : s ? (
        <>
          <Card className="bg-gradient-to-br from-primary to-primary-dim">
            <div className="text-sm font-medium text-white/80">Revenu</div>
            <div className="mt-1 text-3xl font-extrabold text-white">{xof(s.revenueXof)}</div>
            {s.trendPct != null && (
              <div className="mt-1 text-sm text-white/80">
                {s.trendPct >= 0 ? '+' : ''}
                {s.trendPct}% vs période précédente
              </div>
            )}
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Tickets vendus" value={s.ticketsUsed} />
            <Stat label="Tickets générés" value={s.ticketsGenerated} />
            <Stat label="Sessions actives" value={s.activeSessions} />
            <Stat label="Forfaits vendus" value={s.byPlan.reduce((a, p) => a + p.sold, 0)} />
          </div>

          <section>
            <h3 className="mb-3 text-base font-semibold">Par forfait</h3>
            {s.byPlan.length === 0 ? (
              <EmptyState>Aucune vente sur la période.</EmptyState>
            ) : (
              <div className="space-y-2">
                {s.byPlan.map((p) => (
                  <Card key={p.planId} className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-fg">{p.planName}</div>
                      <div className="text-xs text-muted">{p.sold} vendu(s)</div>
                    </div>
                    <div className="font-semibold text-fg">{xof(p.revenueXof)}</div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      <section>
        <h3 className="mb-3 text-base font-semibold">Clients récents</h3>
        {clients.isLoading ? (
          <Loading />
        ) : clients.error ? (
          <ErrorBox message={extractErrorMessage(clients.error)} />
        ) : (clients.data ?? []).length === 0 ? (
          <EmptyState>Aucun client récent.</EmptyState>
        ) : (
          <div className="space-y-2">
            {clients.data!.map((c) => (
              <Card key={c.voucherId} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Dot online={c.online} />
                    <span className="font-mono text-sm text-fg">{c.code}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {c.planName} · {c.redeemedAt ? dateFr(c.redeemedAt) : 'Non utilisé'}
                    {c.ipAddress ? ` · ${c.ipAddress}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold text-fg">{xof(c.priceXof)}</div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
