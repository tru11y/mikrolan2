'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, extractErrorMessage } from '@/lib/api';
import { Dot, ErrorBox, Loading } from '@/components/ui';
import type { RouterLite } from './types';

export function RouterPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (routerId: string) => void;
}) {
  const query = useQuery({
    queryKey: ['routers'],
    queryFn: () => apiGet<RouterLite[]>('/routers'),
  });

  const routers = query.data ?? [];

  // Sélection automatique du premier routeur dès que la liste est connue.
  useEffect(() => {
    if (!value && routers.length > 0) onChange(routers[0]!.id);
  }, [value, routers, onChange]);

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorBox message={extractErrorMessage(query.error)} />;
  if (routers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
        Aucun routeur. Ajoutez-en un depuis l&apos;onglet Routeurs.
      </div>
    );
  }

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {routers.map((r) => {
        const active = r.id === value;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onChange(r.id)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
              active
                ? 'border-primary bg-primary/15 text-fg'
                : 'border-border bg-surface text-muted hover:bg-surface2'
            }`}
          >
            <Dot online={r.health === 'ONLINE'} />
            <span>{r.alias || r.identity}</span>
            <span className="text-xs text-muted">{r.mode}</span>
          </button>
        );
      })}
    </div>
  );
}
