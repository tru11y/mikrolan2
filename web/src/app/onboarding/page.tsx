'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiGet, apiPost, extractErrorMessage } from '@/lib/api';
import { Button, Card, ErrorBox, Loading } from '@/components/ui';

type LegalVersions = { terms: string; privacy: string; remoteAccess: string };

export default function OnboardingPage() {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);

  const legal = useQuery({
    queryKey: ['legal', 'versions'],
    queryFn: () => apiGet<LegalVersions>('/legal/versions'),
  });

  const consent = useMutation({
    mutationFn: () =>
      apiPost<{ accepted: boolean }>('/auth/legal-consent', {
        termsVersion: legal.data?.terms,
        privacyVersion: legal.data?.privacy,
      }),
    onSuccess: () => router.replace('/'),
  });

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-fg">Bienvenue sur MikroLan</h1>
          <p className="mt-2 text-sm text-muted">
            Encore une étape : confirmez votre accord avec nos conditions légales.
          </p>
        </div>

        {legal.isLoading ? (
          <Loading />
        ) : legal.error || !legal.data ? (
          <ErrorBox message={legal.error ? extractErrorMessage(legal.error) : 'Textes légaux indisponibles.'} />
        ) : (
          <div className="space-y-5">
            <ul className="space-y-2 text-sm text-muted">
              <li className="flex items-center justify-between rounded-xl border border-border bg-surface2 px-3.5 py-2.5">
                <span className="text-fg">Conditions d&apos;utilisation</span>
                <span>v{legal.data.terms}</span>
              </li>
              <li className="flex items-center justify-between rounded-xl border border-border bg-surface2 px-3.5 py-2.5">
                <span className="text-fg">Politique de confidentialité</span>
                <span>v{legal.data.privacy}</span>
              </li>
            </ul>

            <label className="flex items-start gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>
                J&apos;ai lu et j&apos;accepte les conditions d&apos;utilisation et la politique de
                confidentialité.
              </span>
            </label>

            {consent.error && <ErrorBox message={extractErrorMessage(consent.error)} />}

            <Button
              className="w-full"
              disabled={!accepted}
              loading={consent.isPending}
              onClick={() => consent.mutate()}
            >
              Continuer
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
