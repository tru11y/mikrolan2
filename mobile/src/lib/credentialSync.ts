import type { RouterLiveData } from '@/src/lib/api';

/**
 * Source de vérité des identifiants RouterOS d'un tenant payant : le serveur
 * (`Router.credEncrypted`, exposé via `hasCredentials`). Le SecureStore local ne
 * sert qu'au LAN. Le backfill local → serveur n'a lieu que si `hasCredentials ===
 * false` (écran Routeur) : jamais d'écrasement automatique d'un secret existant.
 */

export type LiveHealthState = 'fresh' | 'stale' | 'none';
export type LiveFailureKind = 'creds-invalid' | 'creds-missing' | 'tunnel-down' | 'routeros-slow' | 'other' | null;

/**
 * Classe l'échec de la lecture LIVE (RouterGateway). Ne dit RIEN de l'état du
 * tunnel WireGuard, sauf via le code structuré TUNNEL_NOT_PROVISIONED (pas de
 * RemotePeer actif) : l'état Tunnel de l'UI vient de `RemotePeer.status`, jamais
 * d'un message texte. Un timeout / « injoignable » = API RouterOS lente (RB951).
 */
export function classifyLiveFailure(input: {
  errorCode?: string | null;
  message?: string | null;
}): LiveFailureKind {
  const code = input.errorCode ?? '';
  const msg = (input.message ?? '').toLowerCase();
  if (code === 'ROUTER_CREDS_INVALID' || msg.includes('identifiants routeros incorrects')) return 'creds-invalid';
  if (code === 'ROUTER_CREDS_MISSING' || msg.includes('identifiants routeros non configurés')) return 'creds-missing';
  if (code === 'TUNNEL_NOT_PROVISIONED') return 'tunnel-down';
  if (code === 'ROUTER_UNREACHABLE' || msg.includes('injoignable') || msg.includes('timeout')) return 'routeros-slow';
  return input.errorCode || input.message ? 'other' : null;
}

export function liveHealthState(data: RouterLiveData | undefined): LiveHealthState {
  if (!data || data.lastSuccessAt === 0 || data.cpuPercent == null) return 'none';
  return data.stale ? 'stale' : 'fresh';
}
