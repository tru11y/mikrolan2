import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubBreadcrumb, scrubEvent, scrubValue } from './sentryScrub.ts';

test('masque les clés sensibles à tout niveau', () => {
  assert.deepEqual(
    scrubValue({ ok: 1, password: 'x', nested: { Authorization: 'Bearer a', list: [{ voucherCode: '3d1', n: 2 }] } }),
    { ok: 1, password: '[Filtré]', nested: { Authorization: '[Filtré]', list: [{ voucherCode: '[Filtré]', n: 2 }] } },
  );
});

test('fil d’Ariane : data nettoyée', () => {
  assert.deepEqual(scrubBreadcrumb({ data: { url: '/auth/login', token: 't' } }), { data: { url: '/auth/login', token: '[Filtré]' } });
});

test('événement : corps, cookies, e-mail et IP retirés', () => {
  const e = scrubEvent({
    request: { data: { password: 'p' }, cookies: { s: 1 }, headers: { authorization: 'x', accept: 'a' }, query_string: 'code=1' },
    user: { ip_address: '1.2.3.4', email: 'a@b.c' },
    breadcrumbs: [{ data: { password: 'p' } }],
  });
  assert.deepEqual(e.request, { headers: { authorization: '[Filtré]', accept: 'a' }, query_string: '[Filtré]' });
  assert.deepEqual(e.user, {});
  assert.deepEqual(e.breadcrumbs, [{ data: { password: '[Filtré]' } }]);
});
