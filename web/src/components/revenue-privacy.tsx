'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiPost } from '@/lib/api';
import { Button, Input } from '@/components/ui';

const STORAGE_KEY = 'revenue.hidden';

/**
 * Masquage du revenu du jour. Le dévoiler exige le mot de passe du compte ;
 * le masquer ne demande rien. `hidden` démarre à `true` et ne reflète la
 * préférence qu'après montage, pour ne jamais laisser clignoter le montant.
 */
export function useRevenuePrivacy() {
  const [hidden, setHidden] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      setHidden(false);
    }
    setReady(true);
  }, []);

  const persist = useCallback((value: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    } catch {
      /* stockage indisponible : la préférence ne survit pas, sans casser l'UI */
    }
  }, []);

  const hide = useCallback(() => {
    setHidden(true);
    persist(true);
  }, [persist]);

  const reveal = useCallback(() => {
    setHidden(false);
    persist(false);
  }, [persist]);

  return { hidden, ready, hide, reveal };
}

/** Icône œil animée (trait barré qui se dessine/efface selon l'état). */
export function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      <line
        x1="3"
        y1="3"
        x2="21"
        y2="21"
        style={{
          strokeDasharray: 26,
          strokeDashoffset: hidden ? 0 : 26,
          transition: 'stroke-dashoffset 260ms ease',
        }}
      />
    </svg>
  );
}

/** Modale de ré-authentification par mot de passe avant de dévoiler le revenu. */
export function RevealModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setError(null);
      setLoading(false);
    }
  }, [open]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiPost('/auth/verify-password', { password });
      onSuccess();
    } catch {
      setError('Mot de passe incorrect.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl"
      >
        <h2 className="text-lg font-bold text-fg">Afficher le revenu</h2>
        <p className="mt-1 text-sm text-muted">
          Confirmez votre mot de passe pour dévoiler le montant.
        </p>
        <div className="mt-4">
          <Input
            type="password"
            autoFocus
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
        <div className="mt-5 flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" className="flex-1" loading={loading} disabled={!password}>
            Afficher
          </Button>
        </div>
      </form>
    </div>
  );
}
