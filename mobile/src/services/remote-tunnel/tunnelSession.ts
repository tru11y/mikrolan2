/**
 * Machine d'états du cycle de vie d'une session tunnel distant.
 *
 * Volontairement **pure** (aucune dépendance réseau) pour être testable :
 * l'orchestrateur réel (TunnelClient + forwarders) appelle `reduce` à chaque
 * événement et pilote ses effets de bord d'après l'état renvoyé.
 *
 * Cycle : idle → requesting (open-access) → granted → connecting (WS)
 *       → ready (forwarders liés, URLs locales) → closing → closed.
 * `error` et `expired` sont terminaux (sauf reset).
 */

import type { ServiceId } from './tunnelProtocol';

export type SessionPhase =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'connecting'
  | 'ready'
  | 'closing'
  | 'closed'
  | 'expired'
  | 'error';

export type LocalEndpoint = {
  serviceId: ServiceId;
  name: 'webfig' | 'ssh';
  host: string;
  port: number;
  url: string;
};

export type SessionState = {
  phase: SessionPhase;
  /** ms epoch de fin de fenêtre (READY). */
  expiresAtEpochMs: number | null;
  endpoints: LocalEndpoint[];
  error: string | null;
};

export type SessionEvent =
  | { type: 'OPEN_REQUESTED' }
  | { type: 'GRANT_RECEIVED'; expiresAtEpochMs: number }
  | { type: 'GRANT_FAILED'; error: string }
  | { type: 'CONNECTING' }
  | { type: 'READY'; expiresAtEpochMs: number }
  | { type: 'FORWARDER_BOUND'; endpoint: LocalEndpoint }
  | { type: 'CONNECTION_ERROR'; error: string }
  | { type: 'EXPIRED' }
  | { type: 'CLOSE_REQUESTED' }
  | { type: 'CLOSED' }
  | { type: 'RESET' };

export const initialSessionState: SessionState = {
  phase: 'idle',
  expiresAtEpochMs: null,
  endpoints: [],
  error: null,
};

export function reduce(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'RESET':
      return initialSessionState;

    case 'CLOSE_REQUESTED':
      if (state.phase === 'closed' || state.phase === 'idle') return state;
      return { ...state, phase: 'closing' };

    case 'CLOSED':
      return { ...state, phase: 'closed', endpoints: [] };

    case 'EXPIRED':
      if (isTerminal(state.phase)) return state;
      return { ...state, phase: 'expired', endpoints: [] };

    case 'CONNECTION_ERROR':
      if (isTerminal(state.phase)) return state;
      return { ...state, phase: 'error', error: event.error, endpoints: [] };
  }

  // Transitions dépendantes de la phase courante.
  switch (state.phase) {
    case 'idle':
    case 'error':
    case 'expired':
    case 'closed':
      if (event.type === 'OPEN_REQUESTED') {
        return { ...initialSessionState, phase: 'requesting' };
      }
      return state;

    case 'requesting':
      if (event.type === 'GRANT_RECEIVED') {
        return { ...state, phase: 'granted', expiresAtEpochMs: event.expiresAtEpochMs };
      }
      if (event.type === 'GRANT_FAILED') {
        return { ...state, phase: 'error', error: event.error };
      }
      return state;

    case 'granted':
      if (event.type === 'CONNECTING') return { ...state, phase: 'connecting' };
      return state;

    case 'connecting':
      if (event.type === 'READY') {
        return { ...state, phase: 'ready', expiresAtEpochMs: event.expiresAtEpochMs };
      }
      return state;

    case 'ready':
      if (event.type === 'FORWARDER_BOUND') {
        return { ...state, endpoints: upsertEndpoint(state.endpoints, event.endpoint) };
      }
      return state;

    default:
      return state;
  }
}

/** Minutes restantes avant expiration (arrondi bas, 0 minimum). */
export function minutesRemaining(state: SessionState, now = Date.now()): number | null {
  if (state.expiresAtEpochMs === null) return null;
  return Math.max(0, Math.floor((state.expiresAtEpochMs - now) / 60_000));
}

export function isActive(phase: SessionPhase): boolean {
  return phase === 'requesting' || phase === 'granted' || phase === 'connecting' || phase === 'ready';
}

function isTerminal(phase: SessionPhase): boolean {
  return phase === 'error' || phase === 'expired' || phase === 'closed';
}

function upsertEndpoint(endpoints: LocalEndpoint[], next: LocalEndpoint): LocalEndpoint[] {
  const rest = endpoints.filter((e) => e.serviceId !== next.serviceId);
  return [...rest, next];
}
