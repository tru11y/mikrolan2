import { buildDailyRevenueSeries, countActiveDays, localDateKey } from './forecast.series';
import type { ActivationLine } from '../../revenue/revenue.service';

function line(usedAt: Date, xof: number | null, routerId = 'r1', planId = 'p1'): ActivationLine {
  return { usedAt, routerId, planId, xof, source: 'EXACT' };
}

describe('forecast.series — construction bornée, timezone tenant', () => {
  it('4. jours manquants explicites à zéro (jamais un trou silencieux)', () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-05T00:00:00.000Z'); // 4 jours
    const lines = [line(new Date('2026-08-01T10:00:00.000Z'), 100)];
    const series = buildDailyRevenueSeries(lines, from, to, 'UTC');
    expect(series).toHaveLength(4);
    expect(series[0].revenueXof).toBe(100);
    expect(series[1].revenueXof).toBe(0);
    expect(series[2].salesCount).toBe(0);
  });

  it('5. valeurs nulles gérées sans erreur (xof null exclu du revenu, jamais NaN)', () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-02T00:00:00.000Z');
    const lines = [line(new Date('2026-08-01T10:00:00.000Z'), null)];
    const series = buildDailyRevenueSeries(lines, from, to, 'UTC');
    expect(series[0].revenueXof).toBe(0);
    expect(series[0].salesCount).toBe(1); // comptée en vente, jamais en revenu
    expect(Number.isNaN(series[0].revenueXof)).toBe(false);
  });

  it('11. timezone Africa/Abidjan (UTC, pas de décalage) : jour local = jour UTC', () => {
    const at = new Date('2026-08-15T23:30:00.000Z');
    expect(localDateKey(at, 'Africa/Abidjan')).toBe('2026-08-15');
  });

  it('12. timezone DST (Europe/Paris) : un instant proche de minuit UTC peut basculer de jour local', () => {
    // 22:30 UTC en août = 00:30 heure d'été Paris (UTC+2) -> jour suivant.
    const at = new Date('2026-08-15T22:30:00.000Z');
    expect(localDateKey(at, 'Europe/Paris')).toBe('2026-08-16');
  });

  it('29. jours actifs comptés correctement (au moins une vente)', () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-04T00:00:00.000Z');
    const lines = [line(new Date('2026-08-01T10:00:00.000Z'), 100), line(new Date('2026-08-03T10:00:00.000Z'), 50)];
    const series = buildDailyRevenueSeries(lines, from, to, 'UTC');
    expect(countActiveDays(series)).toBe(2);
  });
});
