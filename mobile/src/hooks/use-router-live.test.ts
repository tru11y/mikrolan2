import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEvent, type RouterLiveEventPayload } from './router-live-merge.ts';
import type { RouterLiveData } from '../lib/api.ts';

// Exécuté par le runtime TypeScript natif de Node (>=22) — même convention que
// src/lib/metricsCsvRows.test.ts, aucune dépendance de test à installer :
//   node --test src/hooks/use-router-live.test.ts
//
// Ces tests couvrent la fusion SSE → cache React Query (`mergeEvent`), le
// point le plus sensible du chantier P0 Mobile Realtime : une régression ici
// ferait afficher une donnée d'un autre routeur, effacerait silencieusement
// une liste de sessions déjà connue, ou masquerait un état stale.

const BASE: RouterLiveData = {
  routerId: 'r1',
  lastSuccessAt: 1000,
  health: 'ONLINE',
  cpuPercent: 10,
  memoryUsedMb: 40,
  memoryTotalMb: 128,
  uptime: '1d',
  rosVersion: '7.15',
  boardName: 'hAP',
  sessionCount: 3,
  sessions: [{ id: 'a', user: 'u1', ipAddress: null, macAddress: null, bytesIn: '0', bytesOut: '0', uptime: null }],
  ageMs: 0,
  stale: false,
  refreshing: false,
  lastError: null,
};

test('ROUTER_STATS : remplace les stats mais conserve la liste de sessions déjà connue si ce refresh ne la redemandait pas (want=stats)', () => {
  const event: RouterLiveEventPayload = {
    type: 'ROUTER_STATS',
    routerId: 'r1',
    snapshot: { ...BASE, cpuPercent: 55, sessions: null, sessionCount: 3 },
  };
  const next = mergeEvent(BASE, event);
  assert.equal(next?.cpuPercent, 55);
  assert.deepEqual(next?.sessions, BASE.sessions); // pas écrasée par null
  assert.equal(next?.stale, false);
  assert.equal(next?.refreshing, false);
});

test('ROUTER_STATS : sans snapshot en cache et sans base préalable, ne fabrique rien', () => {
  const event: RouterLiveEventPayload = { type: 'ROUTER_STATS', routerId: 'r1' };
  assert.equal(mergeEvent(undefined, event), undefined);
});

test("SESSION_COUNT_CHANGED : met à jour uniquement le compteur, sans toucher au reste", () => {
  const next = mergeEvent(BASE, { type: 'SESSION_COUNT_CHANGED', routerId: 'r1', sessionCount: 7 });
  assert.equal(next?.sessionCount, 7);
  assert.equal(next?.cpuPercent, BASE.cpuPercent);
  assert.deepEqual(next?.sessions, BASE.sessions);
});

test('SESSIONS_CHANGED : remplace la liste et resynchronise le compteur avec sa longueur', () => {
  const sessions = [
    { id: 'x', user: 'u2', ipAddress: null, macAddress: null, bytesIn: '0', bytesOut: '0', uptime: null },
    { id: 'y', user: 'u3', ipAddress: null, macAddress: null, bytesIn: '0', bytesOut: '0', uptime: null },
  ];
  const next = mergeEvent(BASE, { type: 'SESSIONS_CHANGED', routerId: 'r1', sessions });
  assert.deepEqual(next?.sessions, sessions);
  assert.equal(next?.sessionCount, 2);
});

test('ROUTER_LIVE_STALE : marque la donnée périmée sans effacer les dernières valeurs (stale ≠ écran vide)', () => {
  const next = mergeEvent(BASE, { type: 'ROUTER_LIVE_STALE', routerId: 'r1' });
  assert.equal(next?.stale, true);
  assert.equal(next?.refreshing, false);
  assert.equal(next?.cpuPercent, BASE.cpuPercent); // toujours affichable
  assert.equal(next?.sessionCount, BASE.sessionCount);
});

test('ROUTER_LIVE_STALE sans snapshot préalable : ne fabrique pas une donnée fantôme', () => {
  assert.equal(mergeEvent(undefined, { type: 'ROUTER_LIVE_STALE', routerId: 'r1' }), undefined);
});

test('ROUTER_LIVE_RECOVERED : ne modifie rien seule (le ROUTER_STATS qui suit porte la vraie donnée)', () => {
  const next = mergeEvent(BASE, { type: 'ROUTER_LIVE_RECOVERED', routerId: 'r1' });
  assert.deepEqual(next, BASE);
});

test('événement inconnu ou sessionCount/sessions absent du payload attendu : aucune mutation', () => {
  assert.deepEqual(mergeEvent(BASE, { type: 'SESSION_COUNT_CHANGED', routerId: 'r1' }), BASE);
  assert.deepEqual(mergeEvent(BASE, { type: 'SESSIONS_CHANGED', routerId: 'r1' }), BASE);
});
