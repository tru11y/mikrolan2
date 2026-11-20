'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { dateFr, xof } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorBox, Input, Loading, PageHeader, Stat } from '@/components/ui';
import { AdminGuard, Select, Table, Td, Th, Tr, statusTone } from '@/components/admin/primitives';
import type { FleetRouter, Page, PlatformMetrics, RevenueHistoryItem } from '@/components/admin/types';

const HEALTHS = ['', 'ONLINE', 'OFFLINE', 'DEGRADED', 'UNKNOWN'] as const;

function FlotteInner() {
  const [health, setHealth] = useState('');
  const [q, setQ] = useState('');
  const query = q.trim().length >= 3 ? q.trim() : undefined;

  const metrics = useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: () => apiGet<PlatformMetrics>('/admin/metrics'),
  });
  const revenue = useQuery({
    queryKey: ['admin', 'revenue-history'],
    queryFn: () => apiGet<RevenueHistoryItem[]>('/admin/revenue-history', { months: 6 }),
  });
  const fleet = useQuery({
    queryKey: ['admin', 'fleet', health, query ?? ''],
    queryFn: () =>
      apiGet<Page<FleetRouter>>('/admin/fleet', {
        ...(health ? { health } : {}),
        ...(query ? { q: query } : {}),
        limit: 100,
      }),
  });

  const m = metrics.data;
  const items = fleet.data?.items ?? [];

  return (
    <div>
      <PageHeader title="Flotte globale" />

      {metrics.isLoading ? (
        <Loading />
      ) : metrics.error ? (
        <ErrorBox message="Impossible de charger les métriques." />
      ) : m ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Comptes" value={m.tenants.total} sub={`${m.tenants.pro} PRO · ${m.tenants.trialing} essais`} />
          <Stat label="MRR" value={xof(m.revenue.mrrXof)} sub={`${m.revenue.untieredActive} hors grille`} />
          <Stat label="Routeurs" value={`${m.routers.online}/${m.routers.total}`} sub="en ligne" />
          <Stat label="Factures en attente" value={m.pendingInvoices} sub={`${m.trialsExpiringIn7Days} essais ≤7j`} />
        </div>
      ) : null}

      <Card className="mb-6">
        <h2 className="mb-3 text-lg font-semibold">Revenu (6 derniers mois)</h2>
        {revenue.isLoading ? (
          <Loading />
        ) : revenue.error ? (
          <ErrorBox message="Historique indisponible." />
        ) : (revenue.data?.length ?? 0) === 0 ? (
          <EmptyState>Aucune donnée.</EmptyState>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {(revenue.data ?? []).map((r) => (
              <div key={r.month} className="rounded-xl border border-border bg-surface2 p-3">
                <div className="text-xs text-muted">{r.month}</div>
                <div className="mt-1 font-semibold text-fg">{xof(r.total)}</div>
                <div className="text-xs text-muted">{r.count} paiements</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-64"><Input placeholder="Rechercher (min. 3)…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-48"><Select value={health} onChange={(e) => setHealth(e.target.value)}>
          {HEALTHS.map((h) => <option key={h} value={h}>{h === '' ? 'Toutes les santés' : h}</option>)}
        </Select></div>
      </div>

      {fleet.isLoading ? (
        <Loading />
      ) : fleet.error ? (
        <ErrorBox message="Impossible de charger la flotte." />
      ) : items.length === 0 ? (
        <EmptyState>Aucun routeur.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Routeur</Th>
              <Th>Compte</Th>
              <Th>Mode</Th>
              <Th>Santé</Th>
              <Th>CPU / RAM</Th>
              <Th>Dernière sync</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const tel = r.telemetry;
              const ram = tel?.ramUsedMb != null && tel?.ramTotalMb != null
                ? `${Math.round((tel.ramUsedMb / tel.ramTotalMb) * 100)}%`
                : '—';
              return (
                <Tr key={r.id}>
                  <Td>
                    {r.alias || r.identity}
                    <div className="text-xs text-muted">{r.model ?? '—'}{tel?.rosVersion ? ` · ${tel.rosVersion}` : ''}</div>
                  </Td>
                  <Td>{r.tenant.name}</Td>
                  <Td><Badge tone="muted">{r.mode}</Badge></Td>
                  <Td>
                    <Badge tone={statusTone(r.health)}>{r.health}</Badge>
                    {r.syncFailCount > 0 && <span className="ml-2 text-xs text-danger">{r.syncFailCount} échecs</span>}
                  </Td>
                  <Td className="text-muted">{tel?.cpuPercent != null ? `${tel.cpuPercent}%` : '—'} / {ram}</Td>
                  <Td className="text-muted">{dateFr(r.lastSyncAt)}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}

export default function AdminFlottePage() {
  return (
    <AdminGuard roles={['SUPER_ADMIN']}>
      <FlotteInner />
    </AdminGuard>
  );
}
