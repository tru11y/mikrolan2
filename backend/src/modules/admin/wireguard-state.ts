import type { RemotePeerStatus } from '@prisma/client';

/** Même seuil que WireGuardReconciler : un routeur est ONLINE si son handshake a moins de 150 s. */
export const HANDSHAKE_FRESH_S = 150;

export type WgPeerState =
  | 'HEALTHY'
  | 'STALE'
  | 'NEVER'
  | 'UNKNOWN'
  | 'PENDING'
  | 'REVOKED'
  | 'ERROR';

export const WG_PEER_STATES: readonly WgPeerState[] = [
  'HEALTHY',
  'STALE',
  'NEVER',
  'UNKNOWN',
  'PENDING',
  'REVOKED',
  'ERROR',
];

/** Les plus urgents d'abord : c'est ce qui rend un tunnel cassé visible en tête de liste. */
const SEVERITY: Record<WgPeerState, number> = {
  NEVER: 0,
  STALE: 1,
  UNKNOWN: 2,
  ERROR: 3,
  PENDING: 4,
  HEALTHY: 5,
  REVOKED: 6,
};

export function stateSeverity(state: WgPeerState): number {
  return SEVERITY[state];
}

/**
 * `latestHandshake` : secondes Unix lues sur `wg`, 0 si jamais, `null` si la lecture
 * live est indisponible (WG désactivé ou `wg` en échec) — jamais déduit de 0.
 */
export function classifyPeer(
  status: RemotePeerStatus,
  latestHandshake: number | null,
  nowS: number,
): { state: WgPeerState; handshakeAgeS: number | null } {
  const handshakeAgeS =
    latestHandshake !== null && latestHandshake > 0
      ? Math.max(0, nowS - latestHandshake)
      : null;

  if (status !== 'ACTIVE') return { state: status, handshakeAgeS };
  if (latestHandshake === null) return { state: 'UNKNOWN', handshakeAgeS: null };
  if (handshakeAgeS === null) return { state: 'NEVER', handshakeAgeS: null };
  return {
    state: handshakeAgeS < HANDSHAKE_FRESH_S ? 'HEALTHY' : 'STALE',
    handshakeAgeS,
  };
}
