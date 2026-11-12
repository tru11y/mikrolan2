import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoute, safeData, scrubBreadcrumb, scrubEvent, scrubString, scrubValue } from './sentryScrub.ts';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
const WG_PRIV = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
const WG_PUB = 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=';
const gone = (v: unknown, secret: string) => assert.equal(JSON.stringify(v).includes(secret), false, `fuite : ${secret}`);
const ev = (extra: Record<string, unknown>) => scrubEvent({ extra });

test('1 Authorization Bearer', () => gone(scrubEvent({ request: { headers: { Authorization: `Bearer ${JWT}` } }, message: `Bearer ${JWT}` }), JWT));
test('2 JWT en texte libre', () => assert.equal(scrubString(`x ${JWT} y`), 'x [jwt] y'));
test('3 refresh token', () => gone(ev({ refreshToken: 'rt-secret-1', nested: { refresh_token: 'rt-secret-2' } }), 'rt-secret'));
test('4 Cookie et Set-Cookie', () => {
  const e = scrubEvent({ request: { headers: { Cookie: 'sid=abc123', 'Set-Cookie': 'sid=abc123', accept: 'a' }, cookies: { sid: 'abc123' } } });
  gone(e, 'abc123');
  assert.equal(e.request?.headers?.accept, 'a');
});
test('5 mot de passe routeur', () => gone(ev({ routerPassword: 'R0uter!pw', credEncrypted: 'Zm9v' }), 'R0uter!pw'));
test('6 username RouterOS', () => gone(ev({ username: 'admin-ros', routerUsername: 'admin-ros' }), 'admin-ros'));
test('7 code de ticket', () => gone(ev({ voucherCode: '3d1005', code: '3d1005' }), '3d1005'));
test('8 mot de passe de ticket', () => gone(ev({ ticketPassword: 'tp-9981', passwordHotspot: 'tp-9981' }), 'tp-9981'));
test('9 voucherId', () => gone(ev({ voucherId: 'ckvoucher000000000000001' }), 'ckvoucher'));
test('10 batchId', () => gone(ev({ batchId: 'ckbatch0000000000000001', plan_id: 'x' }), 'ckbatch'));
test('11 e-mail', () => gone(scrubEvent({ message: 'échec pour a.b@ex-ample.ci', extra: { email: 'a.b@ex-ample.ci' } }), 'a.b@'));
test('12 téléphone', () => assert.equal(scrubString('appel +225 07 12 34 56 78 ok').includes('07 12'), false));
test('13 IPv4', () => assert.equal(scrubString('hôte 192.168.88.1 down'), 'hôte [ip] down'));
test('14 IPv6', () => {
  assert.equal(scrubString('hôte 2001:db8:85a3:0:0:8a2e:370:7334 down').includes('2001'), false);
  assert.equal(scrubString('hôte fe80::1 down').includes('fe80'), false);
});
test('15 MAC avec : et -', () => {
  assert.equal(scrubString('AA:BB:CC:DD:EE:FF'), '[mac]');
  assert.equal(scrubString('aa-bb-cc-dd-ee-ff'), '[mac]');
});
test('16 clé privée WireGuard', () => gone(scrubEvent({ message: `k=${WG_PRIV}`, extra: { privateKey: WG_PRIV } }), WG_PRIV));
test('17 clé publique WireGuard', () => gone(scrubEvent({ message: `k=${WG_PUB}`, extra: { wgPublicKey: WG_PUB } }), WG_PUB));
test('18 référence SasPay', () => gone(ev({ saspayReference: 'SP-REF-77', reference: 'SP-REF-77' }), 'SP-REF-77'));
test('19 corps de paiement SasPay', () =>
  gone(scrubEvent({ contexts: { saspay: { body: { amount: 1000, msisdn: '0712345678' } } }, extra: { saspayResponse: { x: 'SP-BODY' } } }), 'SP-BODY'));
test('20 requête réelle /vouchers/search?q=3d1005', () => {
  const b = scrubBreadcrumb({
    category: 'xhr',
    data: { method: 'GET', url: 'https://api.mikrolan.net/api/routers/ckrouter0000000000000001/vouchers/search?q=3d1005', status_code: 200, duration: 12 },
  });
  gone(b, '3d1005');
  assert.deepEqual(b.data, { method: 'GET', url: '/api/routers/:id/vouchers/search', status_code: 200, duration: 12 });
});
test('21 données imbriquées dans extra', () => gone(ev({ a: { b: [{ c: { password: 'deep-pw' } }] } }), 'deep-pw'));
test('22 données imbriquées dans contexts', () => gone(scrubEvent({ contexts: { r: { creds: { token: 'ctx-tok' } } } }), 'ctx-tok'));
test('23 données dans tags', () => gone(scrubEvent({ tags: { who: 'a@b.ci', ticketCode: '3d1005', role: 'OWNER' } }), 'a@b.ci'));
test('24 message d’exception', () => {
  const e = scrubEvent({ exception: { values: [{ value: 'RouterOS 192.168.88.1 user=admin ?code=3d1005' }] } });
  gone(e, '192.168.88.1');
  gone(e, '3d1005');
});
test('25 breadcrumb console', () => gone(scrubBreadcrumb({ category: 'console', message: 'login a@b.ci ?token=zzz 10.0.0.2' }), 'zzz'));
test('26 breadcrumb fetch/XHR : liste blanche', () => {
  const b = scrubBreadcrumb({
    category: 'fetch',
    data: { method: 'POST', url: '/api/auth/login?x=1', status_code: 401, duration: 5, request_body: 'p', response_body: 'r', headers: { a: 1 } },
  });
  assert.deepEqual(Object.keys(b.data ?? {}).sort(), ['duration', 'method', 'status_code', 'url']);
});
test('27 profondeur au-delà de la limite', () => {
  let o: Record<string, unknown> = { password: 'x', leaf: 'LEAFSECRET' };
  for (let i = 0; i < 10; i++) o = { n: o };
  gone(scrubValue(o), 'LEAFSECRET');
});
test('28 valeur circulaire', () => {
  const a: Record<string, unknown> = { k: 1 };
  a.self = a;
  assert.doesNotThrow(() => JSON.stringify(scrubValue(a)));
});

test('route : codes alphanumériques, CUID, CUID2, ULID, ObjectId, lots, majuscules, encodage, fragment', () => {
  for (const seg of ['3d1005', 'CKABCDEFGHIJKLMNOPQRSTUVW', 'cm1abc2def3ghi4jkl5mno6p', '01ARZ3NDEKTSV4RRFFQ69G5FAV', '507f1f77bcf86cd799439011', 'LOT-2026-001', 'Router1', '%33d1005', '0b8a1f4e-1111-2222-3333-444455556666', '42']) {
    assert.equal(normalizeRoute(`/api/routers/${seg}/vouchers`), '/api/routers/:id/vouchers', seg);
  }
  assert.equal(normalizeRoute('https://192.168.88.1/rest/ip/hotspot/user?name=x#frag'), '/rest/ip/hotspot/user');
  assert.equal(normalizeRoute('/a/3d1005/b/3d1005?q=3d1005&q=3d1005'), '/a/:id/b/:id');
});
test('query : aucune query string conservée, quel que soit le nom', () => {
  for (const q of ['q', 'code', 'voucher', 'search', 'token', 'key', 'username', 'Q', 'CODE']) {
    gone(normalizeRoute(`/api/v?${q}=3d1005`), '3d1005');
    assert.equal(normalizeRoute(`/api/v?${q}=3d1005`).includes('?'), false);
  }
  assert.equal(scrubString('/x?code=3d1005&token=zzz').includes('3d1005'), false);
});
test('safeData : seulement nombres et booléens', () => {
  assert.deepEqual(safeData({ routerId: 'abc', routerName: 'FREEDOM', ticketCount: 3, ok: true, kind: 'x' }), { ticketCount: 3, ok: true });
  assert.equal(safeData(undefined), undefined);
});

test('utilité conservée : type, message, stack, méthode, route, statut, durée, release, dist, environnement, rôle', () => {
  const e = scrubEvent({
    message: 'Échec chargement',
    exception: { values: [{ type: 'TypeError', value: 'boom', stacktrace: { frames: [{ filename: 'app.js' }] } }] },
    tags: { role: 'OWNER', environment: 'production', release: 'com.mikrolan.app@1.2.0+45', dist: '45' },
    contexts: { http: { method: 'GET', status_code: 500, duration: 30 } },
  } as never) as unknown as {
    message: string;
    exception: { values: { type: string; value: string; stacktrace: unknown }[] };
    tags: Record<string, string>;
    contexts: { http: Record<string, unknown> };
  };
  assert.equal(e.exception.values[0]?.type, 'TypeError');
  assert.equal(e.exception.values[0]?.value, 'boom');
  assert.ok(e.exception.values[0]?.stacktrace);
  assert.equal(e.message, 'Échec chargement');
  assert.deepEqual(e.tags, { role: 'OWNER', environment: 'production', release: 'com.mikrolan.app@1.2.0+45', dist: '45' });
  assert.deepEqual(e.contexts.http, { method: 'GET', status_code: 500, duration: 30 });
  const b = scrubBreadcrumb({ category: 'xhr', data: { method: 'GET', url: '/api/routers', status_code: 200, duration: 9 } });
  assert.deepEqual(b.data, { method: 'GET', url: '/api/routers', status_code: 200, duration: 9 });
});
