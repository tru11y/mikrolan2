'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, extractErrorMessage } from '@/lib/api';
import type { RouterSummary } from '@/lib/types';
import { bytes } from '@/lib/format';
import { Badge, Button, Card, Dot, EmptyState, ErrorBox, Loading, PageHeader, Spinner } from '@/components/ui';

// Forme réelle servie par GET /routers/:id/sessions (octets en chaînes RouterOS).
type LiveSession = {
  id: string;
  user: string;
  ipAddress: string | null;
  macAddress: string | null;
  bytesIn: string;
  bytesOut: string;
  uptime: string | null;
};

function toBytes(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Durée RouterOS « 1d2h3m4s » → libellé compact FR.
function fmtUptime(uptime: string | null): string {
  if (!uptime) return '—';
  const m = uptime.match(/(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!m) return uptime;
  const [, w, d, h, min] = m;
  const weeks = Number(w ?? 0);
  const days = Number(d ?? 0) + weeks * 7;
  const hours = Number(h ?? 0);
  const mins = Number(min ?? 0);
  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${mins.toString().padStart(2, '0')}`;
  return `${mins} min`;
}

export default function SessionsPage() {
  const qc = useQueryClient();
  const [routerId, setRouterId] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);

  const routers = useQuery({
    queryKey: ['routers'],
    queryFn: () => apiGet<RouterSummary[]>('/routers'),
  });

  const sessions = useQuery({
    queryKey: ['sessions', routerId],
    queryFn: () => apiGet<LiveSession[]>(`/routers/${routerId}/sessions`),
    enabled: Boolean(routerId),
  });

  const terminate = useMutation({
    mutationFn: (mikrotikId: string) =>
      apiPost<{ terminated: boolean }>(`/routers/${routerId}/sessions/terminate`, { mikrotikId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions', routerId] }),
    onError: (e) => setActionError(extractErrorMessage(e)),
  });

  const sync = useMutation({
    mutationFn: () =>
      apiPost<{ synced: number }>(`/routers/${routerId}/sessions/sync`, { active: sessions.data ?? [] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions', routerId] }),
    onError: (e) => setActionError(extractErrorMessage(e)),
  });

  const list = sessions.data ?? [];

  return (
    <div>
      <PageHeader
        title="Sessions"
        action={
          routerId ? (
            <Button variant="ghost" loading={sync.isPending} onClick={() => { setActionError(null); sync.mutate(); }}>
              Synchroniser
            </Button>
          ) : undefined
        }
      />

      {routers.isLoading ? (
        <Loading />
      ) : routers.error ? (
        <ErrorBox message={extractErrorMessage(routers.error)} />
      ) : (routers.data ?? []).length === 0 ? (
        <EmptyState>Aucun routeur disponible.</EmptyState>
      ) : (
        <div className="mb-5">
          <label className="mb-1.5 block text-sm text-muted">Routeur</label>
          <select
            value={routerId}
            onChange={(e) => { setRouterId(e.target.value); setActionError(null); }}
            className="w-full max-w-sm rounded-xl border border-border bg-surface2 px-3.5 py-2.5 text-fg outline-none focus:border-primary"
          >
            <option value="">Sélectionner un routeur…</option>
            {(routers.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.alias || r.identity}
              </option>
            ))}
          </select>
        </div>
      )}

      {actionError && <div className="mb-4"><ErrorBox message={actionError} /></div>}

      {!routerId ? (
        <EmptyState>Choisissez un routeur pour afficher ses sessions actives.</EmptyState>
      ) : sessions.isLoading ? (
        <Loading />
      ) : sessions.error ? (
        <ErrorBox message={extractErrorMessage(sessions.error)} />
      ) : list.length === 0 ? (
        <EmptyState>Aucune session active sur ce routeur.</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Utilisateur</th>
                <th className="px-4 py-3 font-medium">MAC</th>
                <th className="px-4 py-3 font-medium">IP</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 font-medium">Octets ↓ / ↑</th>
                <th className="px-4 py-3 font-medium">Durée</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.map((srow) => (
                <tr key={srow.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 font-medium text-fg">{srow.user || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{srow.macAddress ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{srow.ipAddress ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <Dot online />
                      <Badge tone="success">Active</Badge>
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">
                    {bytes(toBytes(srow.bytesIn))} / {bytes(toBytes(srow.bytesOut))}
                  </td>
                  <td className="px-4 py-3 text-muted">{fmtUptime(srow.uptime)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { setActionError(null); terminate.mutate(srow.id); }}
                      disabled={terminate.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-danger/15 px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger/25 disabled:opacity-50"
                    >
                      {terminate.isPending && terminate.variables === srow.id ? <Spinner size={12} /> : null}
                      Terminer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
