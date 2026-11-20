'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, extractErrorMessage } from '@/lib/api';
import { Badge, Button, Card, ErrorBox, Spinner } from '@/components/ui';
import { dateFr } from '@/lib/format';
import type { RemoteAccessAuthorization } from './types';

export function RemoteAccessSection() {
  const qc = useQueryClient();
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const query = useQuery({
    queryKey: ['remote-access', 'authorization'],
    queryFn: () => apiGet<RemoteAccessAuthorization>('/remote-access/authorization'),
  });

  const accept = useMutation({
    mutationFn: (version: string) =>
      apiPost<RemoteAccessAuthorization>('/remote-access/authorization/accept', { version }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remote-access', 'authorization'] }),
  });

  const revoke = useMutation({
    mutationFn: () =>
      apiPost<{ revoked: boolean }>('/remote-access/authorization/revoke', {}),
    onSuccess: () => {
      setConfirmRevoke(false);
      qc.invalidateQueries({ queryKey: ['remote-access', 'authorization'] });
    },
  });

  const auth = query.data;
  const upToDate = auth?.accepted && auth.acceptedVersion === auth.currentVersion;

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-fg">Accès distant</h2>
          <p className="mt-1 text-sm text-muted">
            Autorisation d&apos;accéder à distance à vos routeurs (CGV accès distant).
          </p>
        </div>
        {auth && (
          <Badge tone={upToDate ? 'success' : auth.accepted ? 'warning' : 'muted'}>
            {upToDate ? 'Autorisé' : auth.accepted ? 'À renouveler' : 'Non autorisé'}
          </Badge>
        )}
      </div>

      {query.isLoading ? (
        <div className="mt-4">
          <Spinner size={18} />
        </div>
      ) : query.error ? (
        <div className="mt-4">
          <ErrorBox message={extractErrorMessage(query.error)} />
        </div>
      ) : auth ? (
        <>
          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Version en vigueur</dt>
              <dd className="font-medium text-fg">{auth.currentVersion}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Version acceptée</dt>
              <dd className="font-medium text-fg">{auth.acceptedVersion ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Accepté le</dt>
              <dd className="font-medium text-fg">{auth.acceptedAt ? dateFr(auth.acceptedAt) : '—'}</dd>
            </div>
          </dl>

          {(accept.error || revoke.error) && (
            <div className="mt-3">
              <ErrorBox message={extractErrorMessage(accept.error ?? revoke.error)} />
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {!upToDate && (
              <Button
                loading={accept.isPending}
                onClick={() => accept.mutate(auth.currentVersion)}
              >
                {auth.accepted ? 'Renouveler le consentement' : 'Autoriser'}
              </Button>
            )}
            {auth.accepted &&
              (confirmRevoke ? (
                <>
                  <Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate()}>
                    Confirmer la révocation
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmRevoke(false)} disabled={revoke.isPending}>
                    Annuler
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmRevoke(true)}>
                  Révoquer l&apos;accès
                </Button>
              ))}
          </div>
        </>
      ) : null}
    </Card>
  );
}
