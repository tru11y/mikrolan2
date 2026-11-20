'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiPost, clearTokens, extractErrorMessage } from '@/lib/api';
import { Button, Card, ErrorBox } from '@/components/ui';

export function SessionsSection() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  const mutation = useMutation({
    mutationFn: () => apiPost<void>('/auth/logout-all', {}),
    onSuccess: () => {
      clearTokens();
      router.replace('/login');
    },
  });

  return (
    <Card>
      <h2 className="text-lg font-semibold text-fg">Sessions</h2>
      <p className="mt-1 text-sm text-muted">
        Déconnecter tous les appareils connectés à ce compte. Vous devrez vous reconnecter.
      </p>
      {mutation.error && (
        <div className="mt-3">
          <ErrorBox message={extractErrorMessage(mutation.error)} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {confirming ? (
          <>
            <Button variant="danger" loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Confirmer la déconnexion
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={mutation.isPending}>
              Annuler
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            Déconnecter toutes les sessions
          </Button>
        )}
      </div>
    </Card>
  );
}
