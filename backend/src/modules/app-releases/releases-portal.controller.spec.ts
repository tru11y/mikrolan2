import { ReleasesPortalController } from './releases-portal.controller';
import { PORTAL_CSS } from './portal/releases-portal.css';
import { PORTAL_HTML } from './portal/releases-portal.html';
import { PORTAL_JS } from './portal/releases-portal.js';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { NO_ENVELOPE_KEY } from '../../common/decorators/no-envelope.decorator';

const makeReply = () => {
  const headers: Record<string, string> = {};
  return {
    headers,
    header: jest.fn((k: string, v: string) => {
      headers[k] = v;
    }),
  };
};

const build = (origin: string) =>
  new ReleasesPortalController({ uploadOrigin: origin } as never);

describe('ReleasesPortalController', () => {
  it('est public et sans enveloppe JSON', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ReleasesPortalController)).toBe(true);
    expect(Reflect.getMetadata(NO_ENVELOPE_KEY, ReleasesPortalController)).toBe(true);
  });

  it('CSP : self uniquement + origine S3 en connect-src, pas de script inline', () => {
    const reply = makeReply();
    const html = build('https://b.s3.eu-west-3.amazonaws.com').page(reply as never);
    const csp = reply.headers['Content-Security-Policy'];

    expect(html).toBe(PORTAL_HTML);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' https://b.s3.eu-west-3.amazonaws.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(reply.headers['Cache-Control']).toBe('no-store');
  });

  it('sans S3 configuré : connect-src limité à self', () => {
    const reply = makeReply();
    build('').page(reply as never);
    expect(reply.headers['Content-Security-Policy']).toContain("connect-src 'self';");
  });

  it('sert le JS et le CSS avec le bon type', () => {
    const r1 = makeReply();
    const r2 = makeReply();
    expect(build('').script(r1 as never)).toBe(PORTAL_JS);
    expect(r1.headers['Content-Type']).toContain('application/javascript');
    expect(build('').style(r2 as never)).toBe(PORTAL_CSS);
    expect(r2.headers['Content-Type']).toContain('text/css');
  });
});

describe('Portail — contenu statique', () => {
  it('le HTML ne contient ni script ni style inline, ni handler on*=', () => {
    expect(PORTAL_HTML).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(PORTAL_HTML).not.toMatch(/<style/i);
    expect(PORTAL_HTML).not.toMatch(/\son[a-z]+\s*=/i);
    expect(PORTAL_HTML).not.toMatch(/\sstyle\s*=/i);
  });

  it('le JS est syntaxiquement valide', () => {
    expect(() => new Function(PORTAL_JS)).not.toThrow();
  });

  it('le JS n’utilise ni innerHTML ni eval ni stockage navigateur', () => {
    expect(PORTAL_JS).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|localStorage|sessionStorage/,
    );
  });

  it('le JS référence uniquement des ids présents dans le HTML', () => {
    const used = [...PORTAL_JS.matchAll(/\$\('([a-z-]+)'\)/gi)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    for (const id of new Set(used)) {
      expect(PORTAL_HTML).toContain(`id="${id}"`);
    }
  });
});
