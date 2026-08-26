import type { ActivationLine } from '../../revenue/revenue.service';
import type { DailySeriesPoint } from './forecast.types';

/** Clé de jour local YYYY-MM-DD dans le fuseau du tenant (jamais UTC brut). */
export function localDateKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function dayOfWeekOfKey(dateKey: string, timeZone: string): number {
  // Midi local pour éviter tout basculement de jour lié au DST à minuit.
  const probe = new Date(`${dateKey}T12:00:00.000Z`);
  const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(probe);
  return WEEKDAY_INDEX[weekdayShort] ?? 0;
}

/**
 * Construit une série quotidienne bornée [from, to) dans le fuseau du
 * tenant, jours manquants explicitement à zéro (jamais un trou silencieux).
 * Ne calcule le revenu qu'à partir des `ActivationLine[]` déjà classifiées
 * par RevenueService — jamais de recalcul indépendant.
 */
export function buildDailyRevenueSeries(
  lines: ActivationLine[],
  from: Date,
  to: Date,
  timezone: string,
): DailySeriesPoint[] {
  const byDay = new Map<string, { revenueXof: number; salesCount: number }>();
  for (const line of lines) {
    const key = localDateKey(line.usedAt, timezone);
    const entry = byDay.get(key) ?? { revenueXof: 0, salesCount: 0 };
    entry.revenueXof += line.xof ?? 0;
    entry.salesCount += 1;
    byDay.set(key, entry);
  }

  const points: DailySeriesPoint[] = [];
  const oneDayMs = 24 * 60 * 60 * 1000;
  for (let t = from.getTime(); t < to.getTime(); t += oneDayMs) {
    const key = localDateKey(new Date(t), timezone);
    const entry = byDay.get(key) ?? { revenueXof: 0, salesCount: 0 };
    points.push({ date: key, dayOfWeek: dayOfWeekOfKey(key, timezone), ...entry });
  }
  return points;
}

/** Nombre de jours de la série avec au moins une vente (jours "actifs"). */
export function countActiveDays(series: DailySeriesPoint[]): number {
  return series.filter((p) => p.salesCount > 0).length;
}
