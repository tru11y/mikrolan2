import { deriveClientIpv4 } from './remote-tunnel.gateway';

describe('deriveClientIpv4 — XFF trusted only from loopback', () => {
  it('uses the last XFF hop when the socket comes from loopback', () => {
    expect(deriveClientIpv4('127.0.0.1', '9.9.9.9, 1.2.3.4')).toBe('1.2.3.4');
  });

  it('uses the last XFF hop for an IPv6-mapped loopback socket', () => {
    expect(deriveClientIpv4('::ffff:127.0.0.1', '1.2.3.4')).toBe('1.2.3.4');
  });

  it('ignores XFF when the socket is NOT loopback (anti-spoof)', () => {
    // Connexion directe depuis une IP publique : XFF forgé → ignoré.
    expect(deriveClientIpv4('203.0.113.7', '1.2.3.4')).toBe('203.0.113.7');
  });

  it('returns the direct IP when no XFF present on loopback', () => {
    expect(deriveClientIpv4('127.0.0.1', undefined)).toBe('127.0.0.1');
  });

  it('returns null when the derived value is not valid IPv4', () => {
    expect(deriveClientIpv4('127.0.0.1', 'not-an-ip')).toBeNull();
  });

  it('handles an array XFF header (last entry wins)', () => {
    expect(deriveClientIpv4('127.0.0.1', ['1.1.1.1', '2.2.2.2, 3.3.3.3'])).toBe('3.3.3.3');
  });
});
