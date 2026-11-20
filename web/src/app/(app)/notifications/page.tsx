'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, extractErrorMessage } from '@/lib/api';
import { dateFr } from '@/lib/format';
import { Button, Card, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';

type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
};

export default function NotificationsPage() {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => apiGet<AppNotification[]>('/notifications', { limit: 50 }),
  });
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiGet<{ count: number }>('/notifications/unread-count'),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['notifications'] });
  }

  const markRead = useMutation({
    mutationFn: (id: string) => apiPatch<void>(`/notifications/${id}/read`),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => apiPatch<void>('/notifications/read-all'),
    onSuccess: refresh,
  });

  const items = list.data ?? [];
  const unreadCount = unread.data?.count ?? items.filter((n) => !n.read).length;

  return (
    <div>
      <PageHeader
        title="Notifications"
        action={
          unreadCount > 0 ? (
            <Button variant="ghost" loading={markAll.isPending} onClick={() => markAll.mutate()}>
              Tout marquer comme lu
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 text-sm text-muted">
        {unreadCount > 0 ? (
          <span>
            <span className="font-semibold text-primary">{unreadCount}</span> non lue{unreadCount > 1 ? 's' : ''}
          </span>
        ) : (
          'Tout est à jour.'
        )}
      </div>

      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorBox message={extractErrorMessage(list.error)} />
      ) : items.length === 0 ? (
        <EmptyState>Aucune notification.</EmptyState>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Card
              key={n.id}
              className={`flex items-start justify-between gap-4 ${n.read ? '' : 'border-primary/30 bg-surface2'}`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {!n.read && <span className="inline-block h-2 w-2 rounded-full bg-primary" aria-label="Non lue" />}
                  <span className="font-semibold text-fg">{n.title}</span>
                </div>
                {n.body && <p className="mt-1 text-sm text-muted">{n.body}</p>}
                <div className="mt-1.5 text-xs text-muted">{dateFr(n.createdAt)}</div>
              </div>
              {!n.read && (
                <button
                  onClick={() => markRead.mutate(n.id)}
                  disabled={markRead.isPending}
                  className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-primary/10 disabled:opacity-50"
                >
                  Marquer lu
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
