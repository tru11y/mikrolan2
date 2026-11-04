import { generateTotpSecret, totpAt, verifyTotp } from './totp';

describe('totp', () => {
  // RFC 6238 : secret ASCII "12345678901234567890", T=59 (compteur 1) → 94287082 → 287082 sur 6 chiffres.
  const RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('vecteur RFC 6238', () => {
    expect(totpAt(RFC, 1)).toBe('287082');
  });

  it('accepte le code courant et ±1 pas, refuse au-delà', () => {
    const s = generateTotpSecret();
    const now = 1_700_000_000_000;
    const c = Math.floor(now / 30000);
    expect(verifyTotp(s, totpAt(s, c), now)).toBe(true);
    expect(verifyTotp(s, totpAt(s, c - 1), now)).toBe(true);
    expect(verifyTotp(s, totpAt(s, c + 3), now)).toBe(false);
    expect(verifyTotp(s, 'abcdef', now)).toBe(false);
  });
});
