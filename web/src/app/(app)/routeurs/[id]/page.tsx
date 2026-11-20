'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { xof } from '@/lib/format';
import { Badge, Card, Stat } from '@/components/ui';
import {
  cpuFromResource,
  memoryPercentFromResource,
  type MetricsSummaryX,
  type RemoteStatus,
  type RouterPlan,
  type SystemResource,
} from '@/components/routeurs/shared';

function Gauge({ label, value }: { label: string; value: number | null }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const tone = pct >= 85 ? 'bg-danger' : pct >= 60 ? 'bg-warning' : 'bg-success';
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted">{label}</span>
        <span className="text-xl font-bold text-fg">{value == null ? '—' : `${pct}%`}</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface2">
        <div className={`h-2 rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}

const TUNNEL_TONE: Record<RemoteStatus['status'], 'success' | 'warning' | 'danger' | 'muted'> = {
  ACTIVE: 'success',
  PENDING: 'warning',
  ERROR: 'danger',
  REVOKED: 'muted',
  NONE: 'muted',
};
const TUNNEL_LABEL: Record<RemoteStatus['status'], string> = {
  ACTIVE: 'Tunnel actif',
  PENDING: 'Provisionnement…',
  ERROR: 'Erreur tunnel',
  REVOKED: 'Tunnel révoqué',
  NONE: 'Pas de tunnel',
};

export default function RouterOverviewPage() {
  const { id } = useParams<{ id: string }>();

  const resource = useQuery({
    queryKey: ['router', id, 'system-resource'],
    queryFn: () => apiGet<SystemResource>(`/routers/${id}/remote/system-resource`),
    enabled: Boolean(id),
    retry: false,
    refetchInterval: 15_000,
  });
  const remote = useQuery({
    queryKey: ['router', id, 'remote'],
    queryFn: () => apiGet<RemoteStatus>(`/routers/${id}/remote`),
    enabled: Boolean(id),
    retry: false,
  });
  const summary = useQuery({
    queryKey: ['metrics', 'summary', 'today', id],
    queryFn: () => apiGet<MetricsSummaryX>('/metrics/summary', { period: 'today', routerId: id }),
    enabled: Boolean(id),
  });
  const plans = useQuery({
    queryKey: ['plans', id],
    queryFn: () => apiGet<RouterPlan[]>(`/routers/${id}/plans`),
    enabled: Boolean(id),
  });

  const cpu = cpuFromResource(resource.data);
  const mem = memoryPercentFromResource(resource.data);
  const tunnel = remote.data?.status ?? 'NONE';

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Moniteur de performance</h2>
          {resource.isError && (
            <span className="text-xs text-muted">Indisponible (routeur hors ligne ou local)</span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Gauge label="Processeur (CPU)" value={cpu} />
          <Gauge label="Mémoire" value={mem} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Statistiques du jour</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Sessions actives" value={summary.data?.activeSessions ?? 0} />
          <Stat label="Tickets vendus" value={summary.data?.ticketsUsed ?? 0} />
          <Stat label="Tickets générés" value={summary.data?.ticketsGenerated ?? 0} />
          <Stat label="Forfaits" value={(plans.data ?? []).length} />
        </div>
        {summary.data && (
          <Card className="mt-3">
            <div className="text-sm text-muted">Revenu du jour</div>
            <div className="mt-1 text-2xl font-bold text-fg">{xof(summary.data.revenueXof)}</div>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Accès distant</h2>
        <Card>
          <div className="flex items-center justify-between">
            <Badge tone={TUNNEL_TONE[tunnel]}>{TUNNEL_LABEL[tunnel]}</Badge>
            {remote.data?.endpoint && (
              <span className="text-xs text-muted">{remote.data.endpoint}</span>
            )}
          </div>
          {remote.data?.wgIp && (
            <div className="mt-2 text-xs text-muted">IP WireGuard : {remote.data.wgIp}</div>
          )}
        </Card>
      </section>
    </div>
  );
}
