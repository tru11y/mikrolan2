'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { MetricsSummary, RouterSummary } from '@/lib/types';
import { xof } from '@/lib/format';
import { useState } from 'react';
import { Card, Dot, EmptyState, ErrorBox, Loading, PageHeader, Stat } from '@/components/ui';
import { EyeIcon, RevealModal, useRevenuePrivacy } from '@/components/revenue-privacy';

export default function DashboardPage() {
  const revenue = useRevenuePrivacy();
  const [revealOpen, setRevealOpen] = useState(false);
  const summary = useQuery({
    queryKey: ['metrics', 'summary', 'today'],
    queryFn: () => apiGet<MetricsSummary>('/metrics/summary', { period: 'today' }),
  });
  const routers = useQuery({
    queryKey: ['routers'],
    queryFn: () => apiGet<RouterSummary[]>('/routers'),
  });

  if (summary.isLoading) return <Loading />;

  const s = summary.data;
  const list = routers.data ?? [];
  const online = list.filter((r) => r.health === 'ONLINE').length;

  return (
    <div>
      <PageHeader title="Accueil" />
      {summary.error ? (
        <ErrorBox message="Impossible de charger les indicateurs." />
      ) : (
        <>
          <Card className="mb-6 bg-gradient-to-br from-primary to-primary-dim">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-white/80">Revenu du jour</div>
              <button
                type="button"
                onClick={() => (revenue.hidden ? setRevealOpen(true) : revenue.hide())}
                aria-label={revenue.hidden ? 'Afficher le revenu' : 'Masquer le revenu'}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white/90 transition hover:bg-white/15 active:scale-95"
              >
                <EyeIcon hidden={revenue.hidden} />
              </button>
            </div>
            <div className="mt-1 text-4xl font-extrabold text-white">
              {revenue.hidden ? '••• ••• FCFA' : xof(s?.revenueXof)}
            </div>
            <div className="mt-2 text-sm text-white/80">
              {s?.ticketsUsed ?? 0} tickets vendus · {s?.activeSessions ?? 0} sessions actives
              {s?.trendPct != null && <span className="ml-2">· {s.trendPct >= 0 ? '+' : ''}{s.trendPct}% vs hier</span>}
            </div>
          </Card>

          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Vendus" value={s?.ticketsUsed ?? 0} sub="aujourd'hui" />
            <Stat label="Générés" value={s?.ticketsGenerated ?? 0} sub="aujourd'hui" />
            <Stat label="Sessions" value={s?.activeSessions ?? 0} sub="actives" />
            <Stat label="Routeurs" value={`${online}/${list.length}`} sub="en ligne" />
          </div>
        </>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Mes routeurs</h2>
        <Link href="/routeurs" className="text-sm text-primary hover:underline">
          Tout voir
        </Link>
      </div>
      {routers.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState>Aucun routeur. Ajoutez-en un depuis l&apos;onglet Routeurs.</EmptyState>
      ) : (
        <div className="space-y-2">
          {list.slice(0, 5).map((r) => (
            <Link
              key={r.id}
              href={`/routeurs/${r.id}`}
              className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 transition hover:bg-surface2"
            >
              <div>
                <div className="font-medium">{r.alias || r.identity}</div>
                <div className="text-xs text-muted">{r.health === 'ONLINE' ? 'En ligne' : 'Hors ligne'} · {r.mode}</div>
              </div>
              <Dot online={r.health === 'ONLINE'} />
            </Link>
          ))}
        </div>
      )}

      <RevealModal
        open={revealOpen}
        onClose={() => setRevealOpen(false)}
        onSuccess={() => {
          revenue.reveal();
          setRevealOpen(false);
        }}
      />
    </div>
  );
}
