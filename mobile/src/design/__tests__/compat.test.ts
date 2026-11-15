// MikroLan Connect — Compat legacy → Connect (sélection interne typée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyToConnectRadius, legacyToConnectSpace, legacyToConnectType } from '../compat.ts';
import { connectRadius } from '../tokens/radius.ts';
import { connectSpace } from '../tokens/spacing.ts';
import { connectType } from '../tokens/typography.ts';

test('radius: md/lg/xl alignés sur Connect', () => {
  assert.equal(legacyToConnectRadius.md, connectRadius.md); // 12
  assert.equal(legacyToConnectRadius.lg, connectRadius.lg); // 14 → 16
  assert.equal(legacyToConnectRadius.xl, connectRadius.xl); // 18 → 20
  assert.equal(legacyToConnectRadius.pill, connectRadius.pill);
});

test('space: identique entre legacy et Connect', () => {
  assert.deepEqual(legacyToConnectSpace, connectSpace);
});

test('type: micro passe de 11 à 12 (plancher D0)', () => {
  assert.equal(legacyToConnectType.micro, connectType.micro);
  assert.ok(legacyToConnectType.micro >= 12, 'micro Connect ≥ 12');
});

test('type: body (14 legacy) reste 14 côté secondaire, bodyLg (15) devient body 16', () => {
  assert.equal(legacyToConnectType.body, connectType.secondary);
  assert.equal(legacyToConnectType.bodyLg, connectType.body);
});
