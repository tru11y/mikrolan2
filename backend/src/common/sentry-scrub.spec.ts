import { scrubBreadcrumb, scrubEvent, scrubValue } from './sentry-scrub';

describe('sentry-scrub', () => {
  it('masque les clés sensibles, à tout niveau', () => {
    const out = scrubValue({ ok: 1, password: 'x', nested: { Authorization: 'Bearer abc', list: [{ voucherCode: '3d123', n: 2 }] } });
    expect(out).toEqual({ ok: 1, password: '[Filtré]', nested: { Authorization: '[Filtré]', list: [{ voucherCode: '[Filtré]', n: 2 }] } });
  });
  it('fil d’Ariane : data nettoyée, message conservé', () => {
    const b = scrubBreadcrumb({ message: 'POST /auth/login', data: { url: '/auth/login', token: 't' } });
    expect(b).toEqual({ message: 'POST /auth/login', data: { url: '/auth/login', token: '[Filtré]' } });
  });
  it('événement : corps, cookies, e-mail, IP et en-têtes secrets retirés', () => {
    const e = scrubEvent({
      request: { data: { password: 'p' }, cookies: { s: '1' }, headers: { authorization: 'Bearer x', 'user-agent': 'ua' }, query_string: 'code=123' },
      user: { ip_address: '1.2.3.4', email: 'a@b.c' },
      extra: { cred: 'zz', fine: 1 },
    });
    expect(e.request).toEqual({ headers: { authorization: '[Filtré]', 'user-agent': 'ua' }, query_string: '[Filtré]' });
    expect(e.user).toEqual({});
    expect(e.extra).toEqual({ cred: '[Filtré]', fine: 1 });
  });
  it('profondeur bornée (pas de boucle infinie)', () => {
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 20; i++) { cur.n = {}; cur = cur.n as Record<string, unknown>; }
    expect(() => scrubValue(deep)).not.toThrow();
  });
});
