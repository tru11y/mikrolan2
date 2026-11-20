'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { extractErrorMessage } from '@/lib/api';
import { Button, Card, ErrorBox, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { login, me, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && me) router.replace('/');
  }, [loading, me, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password, needTotp ? totpCode : undefined);
      router.replace('/');
    } catch (err) {
      const msg = extractErrorMessage(err);
      if (/totp|mfa|2fa|code/i.test(msg)) setNeedTotp(true);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/20 text-primary">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12.5a9 9 0 0 1 14 0M8 15.5a5 5 0 0 1 8 0M11 18.5a1.5 1.5 0 0 1 2 0" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-xl font-bold">MikroLan</h1>
          <p className="mt-1 text-sm text-muted">Console web — connexion</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <Input label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label="Mot de passe" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {needTotp && (
            <Input label="Code 2FA" inputMode="numeric" value={totpCode} onChange={(e) => setTotp(e.target.value)} placeholder="123456" />
          )}
          {error && <ErrorBox message={error} />}
          <Button type="submit" loading={busy} className="w-full">
            Se connecter
          </Button>
        </form>
      </Card>
    </main>
  );
}
