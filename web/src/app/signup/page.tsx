'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost, extractErrorMessage, setTokens, type AuthTokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, ErrorBox, Input, Spinner } from '@/components/ui';

type LegalVersions = { terms: string; privacy: string; remoteAccess: string };

export default function SignupPage() {
  const router = useRouter();
  const { refreshMe } = useAuth();
  const [tenantName, setTenantName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const legal = useQuery({
    queryKey: ['legal', 'versions'],
    queryFn: () => apiGet<LegalVersions>('/legal/versions'),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!legal.data) {
      setError('Textes légaux indisponibles, réessayez.');
      return;
    }
    if (!accepted) {
      setError('Vous devez accepter les conditions pour continuer.');
      return;
    }
    setBusy(true);
    try {
      const tokens = await apiPost<AuthTokens>('/auth/signup', {
        tenantName,
        email,
        password,
        termsVersion: legal.data.terms,
        privacyVersion: legal.data.privacy,
        ...(country.trim() ? { country: country.trim() } : {}),
      });
      setTokens(tokens);
      await refreshMe();
      router.replace('/onboarding');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-fg">Créer un compte</h1>
          <p className="mt-1 text-sm text-muted">MikroLan — console web</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <Input label="Nom de l'organisation" value={tenantName} onChange={(e) => setTenantName(e.target.value)} required />
          <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label="Mot de passe" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <Input label="Pays (optionnel)" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Ex. Sénégal" />

          <label className="flex items-start gap-2 text-sm text-muted">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>J&apos;accepte les conditions d&apos;utilisation et la politique de confidentialité.</span>
          </label>

          {error && <ErrorBox message={error} />}
          <Button type="submit" loading={busy} disabled={legal.isLoading} className="w-full">
            {legal.isLoading ? <Spinner size={16} /> : 'Créer mon compte'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          Déjà un compte ?{' '}
          <Link href="/login" className="text-primary hover:underline">
            Se connecter
          </Link>
        </p>
      </Card>
    </main>
  );
}
