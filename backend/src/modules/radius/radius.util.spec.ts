import { assembleOctets, isNasLevelStatus, mikrotikRateLimit } from './radius.util';

describe('assembleOctets', () => {
  it('rend les octets de poids faible seuls quand aucun Gigaword', () => {
    expect(assembleOctets(1000n, 0n)).toBe(1000n);
  });

  it('ajoute un palier de 2^32 par Gigaword', () => {
    expect(assembleOctets(0n, 1n)).toBe(4_294_967_296n);
    expect(assembleOctets(0n, 3n)).toBe(3n * 4_294_967_296n);
  });

  it("reconstitue correctement un compteur au-delà de 2^32 (débordement)", () => {
    expect(assembleOctets(5n, 2n)).toBe(5n + 2n * 4_294_967_296n);
  });
});

describe('mikrotikRateLimit', () => {
  it('formate "up k/down k" quand les deux débits sont connus', () => {
    expect(mikrotikRateLimit(1000, 2000)).toBe('1000k/2000k');
  });

  it('rend undefined (illimité) si un débit manque', () => {
    expect(mikrotikRateLimit(null, 2000)).toBeUndefined();
    expect(mikrotikRateLimit(1000, null)).toBeUndefined();
    expect(mikrotikRateLimit(undefined, undefined)).toBeUndefined();
  });
});

describe('isNasLevelStatus', () => {
  it('distingue les évènements au niveau NAS', () => {
    expect(isNasLevelStatus('Accounting-On')).toBe(true);
    expect(isNasLevelStatus('Accounting-Off')).toBe(true);
    expect(isNasLevelStatus('Start')).toBe(false);
    expect(isNasLevelStatus('Interim-Update')).toBe(false);
    expect(isNasLevelStatus('Stop')).toBe(false);
  });
});
