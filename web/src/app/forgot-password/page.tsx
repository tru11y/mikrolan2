'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { apiPost, extractErrorMessage } from '@/lib/api';
import { Button, Card, ErrorBox, Input } from '@/components/ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');

  const mutation = useMutation({
    mutationFn: () => apiPost<void>('/auth/password-reset/request', { email }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-fg">Mot de passe oublié</h1>
          <p className="mt-1 text-sm text-muted">
            Recevez un code de réinitialisation par email.
          </p>
        </div>

        {mutation.isSuccess ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
              Si un compte existe pour cet email, un code vient d&apos;être envoyé.
            </div>
            <Link href={`/reset-password?email=${encodeURIComponent(email)}`}>
              <Button className="w-full">J&apos;ai reçu un code</Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {mutation.error && <ErrorBox message={extractErrorMessage(mutation.error)} />}
            <Button type="submit" loading={mutation.isPending} className="w-full">
              Envoyer le code
            </Button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-muted">
          <Link href="/login" className="text-primary hover:underline">
            Retour à la connexion
          </Link>
        </p>
      </Card>
    </main>
  );
}
