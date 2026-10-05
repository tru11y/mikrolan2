import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuValue, memoryPercent, sessionsState, statsState } from './liveDisplay.ts';

test('CPU/mémoire inconnus ne deviennent jamais 0', () => {
  assert.equal(cpuValue(''), null);
  assert.equal(cpuValue(undefined), null);
  assert.equal(cpuValue(null), null);
  assert.equal(cpuValue('abc'), null);
  assert.equal(cpuValue('0'), 0);
  assert.equal(cpuValue(0), 0);
  assert.equal(memoryPercent(null, 128), null);
  assert.equal(memoryPercent(10, null), null);
  assert.equal(memoryPercent(10, 0), null);
  assert.equal(memoryPercent(0, 128), 0);
  assert.equal(memoryPercent(64, 128), 50);
});

test('sessions connues + stats inconnues : les deux classes sont indépendantes', () => {
  const d = { sessionCount: 18, cpuPercent: null, stale: false };
  assert.equal(sessionsState(d), 'fresh');
  assert.equal(statsState(d), 'unknown');
});

test('sessions: 0 confirmé ≠ inconnu ; stale conserve le dernier nombre', () => {
  assert.equal(sessionsState({ sessionCount: 0 }), 'fresh');
  assert.equal(sessionsState({ sessionCount: null }), 'unknown');
  assert.equal(sessionsState(undefined), 'unknown');
  assert.equal(sessionsState({ sessionCount: 19, stale: true }), 'stale');
});
