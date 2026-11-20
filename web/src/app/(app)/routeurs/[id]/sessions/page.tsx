'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, extractErrorMessage } from '@/lib/api';
import { Button, Card, EmptyState, ErrorBox, Loading } from '@/components/ui';
import { fmtBytesStr, type LiveSession } from '@/components/routeurs/shared';

export default function RouterSessionsPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['sessions', id],
    queryFn: () => apiGet<LiveSession[]>(`/routers/${id}/sessions`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });

  const terminate = useMutation({
    mutationFn: (mikrotikId: string) =>
      apiPost<{ terminated: boolean }>(`/routers/${id}/sessions/terminate`, { mikrotikId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions', id] }),
    onError: (e) => setActionError(extractErrorMessage(e)),
  });

  const sync = useMutation({
    mutationFn: () =>
      apiPost<{ synced: number }>(`/routers/${id}/sessions/sync`, {
        active: sessions.data ?? [],
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions', id] }),
    onError: (e) => setActionError(extractErrorMessage(e)),
  });

  const list = sessions.data ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sessions actives ({list.length})</h2>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => sync.mutate()}
            loading={sync.isPending}
            disabled={list.length === 0}
          >
            Synchroniser
          </Button>
          <Button
            variant="ghost"
            onClick={() => qc.invalidateQueries({ queryKey: ['sessions', id] })}
          >
            Actualiser
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="mb-4">
          <ErrorBox message={actionError} />
        </div>
      )}

      {sessions.isLoading ? (
        <Loading />
      ) : sessions.error ? (
        <ErrorBox message={extractErrorMessage(sessions.error)} />
      ) : list.length === 0 ? (
        <EmptyState>Aucune session active.</EmptyState>
      ) : (
        <div className="space-y-2">
          {list.map((s) => {
            const total = Number(s.bytesIn || 0) + Number(s.bytesOut || 0);
            return (
              <Card key={s.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-fg">{s.user || '—'}</div>
                  <div className="truncate text-xs text-muted">
                    {s.ipAddress ?? '—'}
                    {s.macAddress ? ` · ${s.macAddress}` : ''}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    ↓ {fmtBytesStr(s.bytesIn)} · ↑ {fmtBytesStr(s.bytesOut)} ·{' '}
                    {fmtBytesStr(String(total))}
                    {s.uptime ? ` · ${s.uptime}` : ''}
                  </div>
                </div>
                <Button
                  variant="danger"
                  onClick={() => {
                    setActionError(null);
                    terminate.mutate(s.id);
                  }}
                  loading={terminate.isPending && terminate.variables === s.id}
                >
                  Terminer
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
