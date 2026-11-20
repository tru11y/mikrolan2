'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPatch, extractErrorMessage } from '@/lib/api';
import { Card, ErrorBox, Spinner } from '@/components/ui';

export function NotificationsSection({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (nextEnabled: boolean) =>
      apiPatch<void>('/auth/me/notifications', { enabled: nextEnabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth', 'me-detail'] }),
  });

  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-fg">Notifications</h2>
          <p className="mt-1 text-sm text-muted">
            Recevoir les alertes (ventes, routeurs hors ligne, support).
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Activer les notifications"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(!enabled)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
            enabled ? 'bg-primary' : 'bg-surface2 border border-border'
          }`}
        >
          {mutation.isPending ? (
            <span className="mx-auto">
              <Spinner size={14} />
            </span>
          ) : (
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          )}
        </button>
      </div>
      {mutation.error && (
        <div className="mt-3">
          <ErrorBox message={extractErrorMessage(mutation.error)} />
        </div>
      )}
    </Card>
  );
}
