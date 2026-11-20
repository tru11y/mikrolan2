'use client';

import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiPost, extractErrorMessage } from '@/lib/api';
import { Button, Card, ErrorBox, Input } from '@/components/ui';

export function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      apiPost<void>('/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      }),
    onSuccess: () => {
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setDone(false);
    if (next.length < 8) {
      setLocalError('Le nouveau mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (next !== confirm) {
      setLocalError('Les mots de passe ne correspondent pas.');
      return;
    }
    mutation.mutate();
  }

  const error = localError || (mutation.error ? extractErrorMessage(mutation.error) : null);

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-fg">Changer de mot de passe</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Mot de passe actuel"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        <Input
          label="Nouveau mot de passe"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <Input
          label="Confirmer le nouveau mot de passe"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {error && <ErrorBox message={error} />}
        {done && (
          <div className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
            Mot de passe mis à jour.
          </div>
        )}
        <Button type="submit" loading={mutation.isPending}>
          Mettre à jour
        </Button>
      </form>
    </Card>
  );
}
