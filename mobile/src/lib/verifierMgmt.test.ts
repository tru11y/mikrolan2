// node --test --experimental-strip-types src/lib/verifierMgmt.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCreateBody,
  displayName,
  isValidEmail,
  isValidPassword,
  routerLabel,
  validateNewVerifier,
} from './verifierMgmt.ts';

const ok = { email: 'v@exemple.ci', password: 'LongPass#1', name: '' };

test('isValidEmail accepts a normal address and rejects malformed ones', () => {
  assert.equal(isValidEmail('v@exemple.ci'), true);
  assert.equal(isValidEmail('  v@exemple.ci  '), true);
  for (const bad of ['', '   ', 'v', 'v@', '@x.ci', 'v@x', 'v @x.ci']) {
    assert.equal(isValidEmail(bad), false, bad);
  }
  assert.equal(isValidEmail('a'.repeat(250) + '@x.ci'), false);
});

test('isValidPassword enforces 8..128 characters', () => {
  assert.equal(isValidPassword('1234567'), false);
  assert.equal(isValidPassword('12345678'), true);
  assert.equal(isValidPassword('a'.repeat(128)), true);
  assert.equal(isValidPassword('a'.repeat(129)), false);
});

test('validateNewVerifier returns the first error key or null', () => {
  assert.equal(validateNewVerifier(ok), null);
  assert.equal(validateNewVerifier({ ...ok, email: 'x' }), 'invalidEmail');
  assert.equal(validateNewVerifier({ ...ok, password: 'short' }), 'weakPassword');
  assert.equal(validateNewVerifier({ ...ok, name: 'n'.repeat(121) }), 'nameTooLong');
});

test('buildCreateBody never sends role, tenant, status or author fields', () => {
  const body = buildCreateBody({ ...ok, name: '  Awa  ' }, 'router-1');
  assert.deepEqual(body, {
    email: 'v@exemple.ci',
    password: 'LongPass#1',
    name: 'Awa',
    routerId: 'router-1',
  });
  for (const k of ['role', 'tenantId', 'status', 'assignedById', 'userId']) {
    assert.ok(!(k in body), k);
  }
});

test('buildCreateBody omits empty name and missing router', () => {
  assert.deepEqual(buildCreateBody(ok, null), {
    email: 'v@exemple.ci',
    password: 'LongPass#1',
  });
});

test('routerLabel prefers alias, falls back to identity, null when unassigned', () => {
  assert.equal(routerLabel(null), null);
  assert.equal(routerLabel({ routerIdentity: 'rb951', routerAlias: 'Boutique' }), 'Boutique');
  assert.equal(routerLabel({ routerIdentity: 'rb951', routerAlias: '  ' }), 'rb951');
  assert.equal(routerLabel({ routerIdentity: 'rb951', routerAlias: null }), 'rb951');
});

test('displayName falls back to the email', () => {
  assert.equal(displayName({ name: 'Awa', email: 'a@x.ci' }), 'Awa');
  assert.equal(displayName({ name: null, email: 'a@x.ci' }), 'a@x.ci');
  assert.equal(displayName({ name: ' ', email: 'a@x.ci' }), 'a@x.ci');
});

import { isReadyToVerify, validateNewPassword } from './verifierMgmt.ts';

test('validateNewPassword refuses weak and mismatching values', () => {
  assert.equal(validateNewPassword('short', 'short'), 'weakPassword');
  assert.equal(validateNewPassword('LongPass#1', 'LongPass#2'), 'mismatch');
  assert.equal(validateNewPassword('LongPass#1', ''), 'mismatch');
  assert.equal(validateNewPassword('LongPass#1', 'LongPass#1'), null);
});

test('isReadyToVerify requires ACTIVE and an assignment', () => {
  assert.equal(isReadyToVerify({ status: 'ACTIVE', assignment: { r: 1 } }), true);
  assert.equal(isReadyToVerify({ status: 'ACTIVE', assignment: null }), false);
  assert.equal(isReadyToVerify({ status: 'SUSPENDED', assignment: { r: 1 } }), false);
  assert.equal(isReadyToVerify({ status: 'DELETED', assignment: { r: 1 } }), false);
});
