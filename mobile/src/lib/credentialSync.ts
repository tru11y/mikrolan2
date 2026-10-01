import type { RouterLiveData } from '@/src/lib/api';

/**
 * Source de vérité des identifiants RouterOS d'un tenant payant : le serveur
 * (`Router.credEncrypted`, exposé via `hasCredentials`). Le SecureStore local ne
 * sert qu'au LAN. Le backfill local → serveur n'a lieu que si `hasCredentials ===
 * false` (écran Routeur) : jamais d'écrasement automatique d'un secret existant.
 */

export type LiveHealthState = 'fresh' | 'stale' | 'none';
export type LiveFailureKind = 'creds-invalid' | 'creds-missing' | 'tunnel' | 'other' | null;

/** Distingue identifiants invalides / tunnel indisponible / autre, sans les mélanger. */
export function classifyLiveFailure(input: {
  errorCode?: string | null;
  message?: string | null;
}): LiveFailureKind {
  const code = input.errorCode ?? '';
  const msg = (input.message ?? '').toLowerCase();
  if (code === 'ROUTER_CREDS_INVALID' || msg.includes('identifiants routeros incorrects')) return 'creds-invalid';
  if (code === 'ROUTER_CREDS_MISSING' || msg.includes('identifiants routeros non configurés')) return 'creds-missing';
  if (
    code === 'TUNNEL_NOT_PROVISIONED' ||
    code === 'ROUTER_UNREACHABLE' ||
    msg.includes('tunnel') ||
    msg.includes('injoignable')
  ) {
    return 'tunnel';
  }
  return input.errorCode || input.message ? 'other' : null;
}

export function liveHealthState(data: RouterLiveData | undefined): LiveHealthState {
  if (!data || data.lastSuccessAt === 0 || data.cpuPercent == null) return 'none';
  return data.stale ? 'stale' : 'fresh';
}
