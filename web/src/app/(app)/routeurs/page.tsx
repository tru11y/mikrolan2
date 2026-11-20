'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiGet, extractErrorMessage } from '@/lib/api';
import { dateFr } from '@/lib/format';
import { Badge, Button, Dot, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { healthLabel, isOnline, type RouterItem } from '@/components/routeurs/shared';

export default function RouteursPage() {
  const routers = useQuery({
    queryKey: ['routers'],
    queryFn: () => apiGet<RouterItem[]>('/routers'),
  });

  return (
    <div>
      <PageHeader
        title="Routeurs"
        action={
          <Link href="/routeurs/ajouter">
            <Button>Ajouter</Button>
          </Link>
        }
      />

      {routers.isLoading ? (
        <Loading />
      ) : routers.error ? (
        <ErrorBox message={extractErrorMessage(routers.error)} />
      ) : (routers.data ?? []).length === 0 ? (
        <EmptyState>
          Aucun routeur enregistré. Cliquez sur « Ajouter » pour en connecter un.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {routers.data!.map((r) => (
            <Link
              key={r.id}
              href={`/routeurs/${r.id}`}
              className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 transition hover:bg-surface2"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-fg">{r.alias || r.identity}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                  <span className="truncate">{r.identity}</span>
                  {r.localAddress && (
                    <>
                      <span>·</span>
                      <span className="truncate">{r.localAddress}</span>
                    </>
                  )}
                  {r.lastHeartbeat && (
                    <>
                      <span>·</span>
                      <span>Vu {dateFr(r.lastHeartbeat)}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge tone={r.mode === 'REMOTE' ? 'primary' : 'muted'}>{r.mode}</Badge>
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <Dot online={isOnline(r.health)} />
                  <span className="hidden sm:inline">{healthLabel(r.health)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
