import type { LiveSession, RouterLiveData } from '../lib/api';

/**
 * Fusion SSE → cache React Query, isolée dans un module SANS import runtime
 * (react-native, react-query, axios…) : le seul moyen de la couvrir avec
 * `node --test` (convention déjà en place côté mobile, `metricsCsvRows.test.ts`)
 * sans que Node bute sur la syntaxe Flow de `react-native/index.js`.
 */
export interface RouterLiveEventPayload {
  type: 'ROUTER_STATS' | 'SESSION_COUNT_CHANGED' | 'SESSIONS_CHANGED' | 'ROUTER_LIVE_STALE' | 'ROUTER_LIVE_RECOVERED';
  routerId: string;
  snapshot?: RouterLiveData;
  sessionCount?: number;
  sessions?: LiveSession[];
}

export function mergeEvent(prev: RouterLiveData | undefined, event: RouterLiveEventPayload): RouterLiveData | undefined {
  if (!prev && event.type !== 'ROUTER_STATS') return prev; // rien à fusionner sans base
  switch (event.type) {
    case 'ROUTER_STATS': {
      const snap = event.snapshot;
      if (!snap) return prev;
      return {
        ...snap,
        // Une session déjà connue ne disparaît pas simplement parce que CE
        // refresh-là n'a pas redemandé la liste (want=stats).
        sessions: snap.sessions ?? prev?.sessions ?? null,
        ageMs: 0,
        stale: false,
        refreshing: false,
        lastError: null,
      };
    }
    case 'SESSION_COUNT_CHANGED':
      return prev && event.sessionCount !== undefined ? { ...prev, sessionCount: event.sessionCount } : prev;
    case 'SESSIONS_CHANGED':
      return prev && event.sessions !== undefined
        ? { ...prev, sessions: event.sessions, sessionCount: event.sessions.length }
        : prev;
    case 'ROUTER_LIVE_STALE':
      // Un refresh vient d'échouer : la dernière donnée reste affichée, mais
      // signalée périmée — jamais un écran vide ni un blocage en OFFLINE tant
      // qu'aucune confirmation n'est arrivée (nuance stale ≠ offline, §9).
      return prev ? { ...prev, stale: true, refreshing: false, lastError: 'Routeur injoignable' } : prev;
    case 'ROUTER_LIVE_RECOVERED':
      return prev; // le ROUTER_STATS qui suit immédiatement porte la vraie donnée
    default:
      return prev;
  }
}
