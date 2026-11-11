import { classifyWgStale, formatAge, shouldAlert, WG_STALE_AFTER_MS } from './wg-stale.logic';

const T0 = Date.UTC(2026, 10, 11, 12, 0, 0);
const at = (msAgo: number) => new Date(T0 - msAgo);
const H = 3_600_000;

describe('classifyWgStale — seuil de 24 h', () => {
  const base = { provisionedAt: at(100 * H), createdAt: at(100 * H) };

  it('23 h 59 min sans handshake → OK', () => {
    expect(classifyWgStale({ ...base, lastHandshakeAt: at(24 * H - 60_000) }, T0).state).toBe('OK');
  });
  it('24 h pile → STALE_24H', () => {
    expect(classifyWgStale({ ...base, lastHandshakeAt: at(24 * H) }, T0).state).toBe('STALE_24H');
  });
  it('jamais connecté, mis en service il y a 23 h 59 → OK ; à 24 h → NEVER_CONNECTED', () => {
    expect(classifyWgStale({ lastHandshakeAt: null, provisionedAt: at(24 * H - 60_000), createdAt: at(30 * H) }, T0).state).toBe('OK');
    expect(classifyWgStale({ lastHandshakeAt: null, provisionedAt: at(24 * H), createdAt: at(30 * H) }, T0).state).toBe('NEVER_CONNECTED');
  });
  it('sans date de mise en service, la création sert de référence', () => {
    expect(classifyWgStale({ lastHandshakeAt: null, provisionedAt: null, createdAt: at(53 * 24 * H) }, T0).state).toBe('NEVER_CONNECTED');
  });
  it('horloge en retard : âge jamais négatif', () => {
    expect(classifyWgStale({ ...base, lastHandshakeAt: new Date(T0 + 5_000) }, T0).ageMs).toBe(0);
  });
});

describe('shouldAlert — 1 alerte / peer / 24 h', () => {
  it('OK : jamais d’alerte', () => expect(shouldAlert('OK', null, T0)).toBe(false));
  it('première alerte', () => expect(shouldAlert('STALE_24H', null, T0)).toBe(true));
  it('déjà alerté il y a 23 h 59 → pas de doublon', () => expect(shouldAlert('STALE_24H', at(WG_STALE_AFTER_MS - 60_000), T0)).toBe(false));
  it('déjà alerté il y a 24 h → rappel', () => expect(shouldAlert('NEVER_CONNECTED', at(WG_STALE_AFTER_MS), T0)).toBe(true));
});

describe('formatAge', () => {
  it('heures puis jours', () => {
    expect(formatAge(24 * H)).toBe('24 h');
    expect(formatAge(53 * 24 * H)).toBe('53 j');
  });
});
