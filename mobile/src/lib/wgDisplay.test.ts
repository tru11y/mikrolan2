import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAge, formatBytes, handshakeLine, heartbeatLine, revokeConfirmed, stateHint } from './wgDisplay.ts';

test('formatAge : unités et inconnu', () => {
  assert.equal(formatAge(0), '0 s');
  assert.equal(formatAge(59), '59 s');
  assert.equal(formatAge(60), '1 min');
  assert.equal(formatAge(3599), '59 min');
  assert.equal(formatAge(3600), '1 h');
  assert.equal(formatAge(86_400), '1 j');
  assert.equal(formatAge(null), '—');
  assert.equal(formatAge(undefined), '—');
  assert.equal(formatAge(Number.NaN), '—');
});

test('formatBytes : 0 reste 0, null devient —', () => {
  assert.equal(formatBytes(0), '0 o');
  assert.equal(formatBytes(null), '—');
  assert.equal(formatBytes(1023), '1023 o');
  assert.equal(formatBytes(1024), '1,0 Ko');
  assert.equal(formatBytes(1536), '1,5 Ko');
  assert.equal(formatBytes(5 * 1024 * 1024), '5,0 Mo');
  assert.equal(formatBytes(3 * 1024 ** 3), '3,0 Go');
});

test('handshakeLine : jamais, jamais depuis N jours, inconnu, récent', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  assert.equal(
    handshakeLine({ state: 'HEALTHY', handshakeAgeS: 42, provisionedAt: null }, now),
    'Handshake il y a 42 s',
  );
  assert.equal(
    handshakeLine({ state: 'NEVER', handshakeAgeS: null, provisionedAt: '2026-10-13T12:00:00Z' }, now),
    'Jamais de handshake (actif depuis 3 j)',
  );
  assert.equal(
    handshakeLine({ state: 'NEVER', handshakeAgeS: null, provisionedAt: null }, now),
    'Jamais de handshake',
  );
  assert.equal(
    handshakeLine({ state: 'UNKNOWN', handshakeAgeS: null, provisionedAt: null }, now),
    'Handshake indisponible',
  );
});

test('heartbeatLine : même format humain que le handshake (jamais en minutes brutes)', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  const ago = (s: number) => new Date(now - s * 1000).toISOString();
  assert.equal(heartbeatLine(ago(350_410), now), 'heartbeat il y a 4 j'); // AZ_OPEN : 6077 min avant
  assert.equal(heartbeatLine(ago(5840 * 60), now), 'heartbeat il y a 4 j'); // 5840 min
  assert.equal(heartbeatLine(ago(2 * 3600 + 120), now), 'heartbeat il y a 2 h');
  assert.equal(heartbeatLine(ago(15 * 60), now), 'heartbeat il y a 15 min');
  assert.equal(heartbeatLine(ago(42), now), 'heartbeat il y a 42 s');
});

test('heartbeatLine : absent ou illisible, jamais « il y a — » ni NaN', () => {
  assert.equal(heartbeatLine(null), 'aucun heartbeat');
  assert.equal(heartbeatLine(''), 'aucun heartbeat');
  assert.equal(heartbeatLine('pas une date'), 'aucun heartbeat');
});

test('heartbeatLine : horloge en avance (heartbeat dans le futur) donne 0 s, pas un nombre négatif', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  assert.equal(heartbeatLine(new Date(now + 30_000).toISOString(), now), 'heartbeat il y a 0 s');
});

test('stateHint : une piste pour chaque état anormal, aucune pour HEALTHY/REVOKED', () => {
  const base = { handshakeAgeS: null, provisionedAt: null };
  assert.match(stateHint({ ...base, state: 'NEVER' }) ?? '', /jamais établi/);
  assert.match(stateHint({ state: 'STALE', handshakeAgeS: 7200, provisionedAt: null }) ?? '', /2 h/);
  assert.ok(stateHint({ ...base, state: 'UNKNOWN' }));
  assert.ok(stateHint({ ...base, state: 'ERROR' }));
  assert.ok(stateHint({ ...base, state: 'PENDING' }));
  assert.equal(stateHint({ ...base, state: 'HEALTHY' }), null);
  assert.equal(stateHint({ ...base, state: 'REVOKED' }), null);
});

test('revokeConfirmed : alias sinon identité, casse et espaces ignorés, vide refusé', () => {
  assert.equal(revokeConfirmed(' az_open ', 'AZ_OPEN', 'id-1'), true);
  assert.equal(revokeConfirmed('id-1', null, 'id-1'), true);
  assert.equal(revokeConfirmed('id-1', '', 'id-1'), true);
  assert.equal(revokeConfirmed('autre', 'AZ_OPEN', 'id-1'), false);
  assert.equal(revokeConfirmed('', '', ''), false);
});
