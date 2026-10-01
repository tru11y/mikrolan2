import type { RouterLiveData } from '@/src/lib/api';

/**
 * Source de vérité des identifiants RouterOS d'un routeur d'un tenant payant :
 * le serveur (`Router.credEncrypted`, AES-256-GCM). Le SecureStore local ne sert
 * qu'au chemin LAN direct.
 *
 * Règle de priorité : le local ne remplace JAMAIS un secret serveur existant de
 * façon automatique. Un push automatique (backfill) n'a lieu que si le serveur
 * n'en a pas ; une reconfiguration reste une action explicite de l'opérateur.
 */
export type CredentialSyncDecision =
  | 'synced' // le serveur a les identifiants
  | 'backfill' // serveur sans identifiants + local présent → push sûr
  | 'missing' // ni serveur ni local : à saisir
  | 'local-only'; // tenant gratuit : le local est voulu (jamais envoyé)

export function decideCredentialSync(input: {
  isPaid: boolean;
  hasServerCreds: boolean;
  hasLocalCreds: boolean;
}): CredentialSyncDecision {
  if (!input.isPaid) return 'local-only';
  if (input.hasServerCreds) return 'synced';
  return input.hasLocalCreds ? 'backfill' : 'missing';
}

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
