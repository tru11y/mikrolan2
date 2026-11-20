'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiGet, extractErrorMessage } from '@/lib/api';
import { Badge, Card, EmptyState, ErrorBox, Loading, Stat } from '@/components/ui';
import { fmtBytesStr, type RouterLiveData } from '@/components/routeurs/shared';

export default function RouterLivePage() {
  const { id } = useParams<{ id: string }>();

  const live = useQuery({
    queryKey: ['router-live', id],
    queryFn: () => apiGet<RouterLiveData>(`/routers/${id}/remote/live`, { want: 'both' }),
    enabled: Boolean(id),
    refetchInterval: 10_000,
    retry: false,
  });

  if (live.isLoading) return <Loading />;
  if (live.error) return <ErrorBox message={extractErrorMessage(live.error)} />;

  const d = live.data;
  if (!d) return <EmptyState>Aucune donnée live disponible.</EmptyState>;

  const memPct =
    d.memoryTotalMb && d.memoryUsedMb != null && d.memoryTotalMb > 0
      ? Math.round((d.memoryUsedMb / d.memoryTotalMb) * 100)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={d.health === 'ONLINE' ? 'success' : d.health === 'OFFLINE' ? 'danger' : 'muted'}>
          {d.health === 'ONLINE' ? 'En ligne' : d.health === 'OFFLINE' ? 'Hors ligne' : 'Inconnu'}
        </Badge>
        {d.stale && <Badge tone="warning">Données non rafraîchies</Badge>}
        {d.refreshing && <Badge tone="primary">Rafraîchissement…</Badge>}
        <span className="text-xs text-muted">
          Mis à jour il y a {Math.round(d.ageMs / 1000)} s
        </span>
      </div>

      {d.lastError && <ErrorBox message={d.lastError} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="CPU" value={d.cpuPercent == null ? '—' : `${d.cpuPercent}%`} />
        <Stat label="Mémoire" value={memPct == null ? '—' : `${memPct}%`} />
        <Stat label="Sessions" value={d.sessionCount ?? '—'} />
        <Stat label="Uptime" value={d.uptime ?? '—'} />
      </div>

      {(d.boardName || d.rosVersion) && (
        <Card>
          <div className="text-sm text-muted">Matériel</div>
          <div className="mt-1 text-fg">
            {d.boardName ?? '—'} {d.rosVersion ? `· RouterOS ${d.rosVersion}` : ''}
          </div>
        </Card>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Sessions en cours</h2>
        {d.sessions == null ? (
          <EmptyState>Liste des sessions non chargée.</EmptyState>
        ) : d.sessions.length === 0 ? (
          <EmptyState>Aucune session active.</EmptyState>
        ) : (
          <div className="space-y-2">
            {d.sessions.map((s) => (
              <Card key={s.id} className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="truncate font-medium text-fg">{s.user || '—'}</div>
                  <div className="truncate text-xs text-muted">
                    {s.ipAddress ?? '—'}
                    {s.macAddress ? ` · ${s.macAddress}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted">
                  <div>↓ {fmtBytesStr(s.bytesIn)} · ↑ {fmtBytesStr(s.bytesOut)}</div>
                  {s.uptime && <div>{s.uptime}</div>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
