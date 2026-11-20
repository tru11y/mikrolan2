'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { apiPost, extractErrorMessage } from '@/lib/api';
import { Button, Card, ErrorBox, Input, Loading } from '@/components/ui';

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiPost<void>('/auth/password-reset/confirm', { email, code, newPassword: password }),
    onSuccess: () => setTimeout(() => router.replace('/login'), 1500),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (password.length < 8) {
      setLocalError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (password !== confirm) {
      setLocalError('Les mots de passe ne correspondent pas.');
      return;
    }
    mutation.mutate();
  }

  const error = localError || (mutation.error ? extractErrorMessage(mutation.error) : null);

  return (
    <Card className="w-full max-w-sm">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-bold text-fg">Nouveau mot de passe</h1>
        <p className="mt-1 text-sm text-muted">Saisissez le code reçu par email.</p>
      </div>

      {mutation.isSuccess ? (
        <div className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          Mot de passe réinitialisé. Redirection vers la connexion…
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label="Code de réinitialisation" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required />
          <Input label="Nouveau mot de passe" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Input label="Confirmer" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          {error && <ErrorBox message={error} />}
          <Button type="submit" loading={mutation.isPending} className="w-full">
            Réinitialiser
          </Button>
        </form>
      )}

      <p className="mt-4 text-center text-sm text-muted">
        <Link href="/login" className="text-primary hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense fallback={<Loading />}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
