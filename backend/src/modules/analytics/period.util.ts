// Résolution des périodes nommées et bornes [from, to) pour le module
// Analytics — réutilise les primitives déjà validées de
// revenue/timezone.util.ts (audit/51/52), n'y ajoute rien, ne les modifie
// pas. Cohérent avec la règle métier Revenue : intervalle semi-ouvert,
// fuseau du tenant, jamais createdAt.
import {
  startOfLocalDayUtc,
  startOfLocalWeekUtc,
  startOfLocalMonthUtc,
} from '../revenue/timezone.util';

export type NamedPeriod =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'currentWeek'
  | 'currentMonth'
  | 'custom';

export interface ResolvedPeriod {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
}

/**
 * Résout une période nommée en bornes [from, to) UTC dans le fuseau donné,
 * plus la période précédente de même durée immédiatement adjacente
 * (pour le calcul de croissance) — jamais chevauchante avec la période
 * courante (évite le double comptage déjà corrigé dans Revenue, audit/55).
 */
export function resolveNamedPeriod(
  period: Exclude<NamedPeriod, 'custom'>,
  timezone: string,
  now: Date = new Date(),
): ResolvedPeriod {
  const todayStart = startOfLocalDayUtc(now, timezone);
  const oneDayMs = 24 * 60 * 60 * 1000;

  switch (period) {
    case 'today': {
      const from = todayStart;
      const to = new Date(from.getTime() + oneDayMs);
      return { from, to, previousFrom: new Date(from.getTime() - oneDayMs), previousTo: from };
    }
    case 'yesterday': {
      const from = new Date(todayStart.getTime() - oneDayMs);
      const to = todayStart;
      return { from, to, previousFrom: new Date(from.getTime() - oneDayMs), previousTo: from };
    }
    case 'last7days': {
      const to = new Date(todayStart.getTime() + oneDayMs);
      const from = new Date(to.getTime() - 7 * oneDayMs);
      const previousTo = from;
      const previousFrom = new Date(previousTo.getTime() - 7 * oneDayMs);
      return { from, to, previousFrom, previousTo };
    }
    case 'last30days': {
      const to = new Date(todayStart.getTime() + oneDayMs);
      const from = new Date(to.getTime() - 30 * oneDayMs);
      const previousTo = from;
      const previousFrom = new Date(previousTo.getTime() - 30 * oneDayMs);
      return { from, to, previousFrom, previousTo };
    }
    case 'currentWeek': {
      const from = startOfLocalWeekUtc(now, timezone);
      const to = new Date(from.getTime() + 7 * oneDayMs);
      const previousFrom = new Date(from.getTime() - 7 * oneDayMs);
      return { from, to, previousFrom, previousTo: from };
    }
    case 'currentMonth': {
      const from = startOfLocalMonthUtc(now, timezone);
      // Premier jour du mois suivant : recalculé via startOfLocalMonthUtc sur
      // un instant clairement dans le mois suivant pour rester correct même
      // sur des mois de longueur variable.
      const probe = new Date(from.getTime() + 32 * oneDayMs);
      const to = startOfLocalMonthUtc(probe, timezone);
      const durationMs = to.getTime() - from.getTime();
      const previousTo = from;
      const previousFrom = new Date(from.getTime() - durationMs);
      return { from, to, previousFrom, previousTo };
    }
  }
}

/** Période précédente de même durée qu'un intervalle [from, to) explicite (mode custom). */
export function previousPeriodOf(from: Date, to: Date): { previousFrom: Date; previousTo: Date } {
  const durationMs = to.getTime() - from.getTime();
  return { previousFrom: new Date(from.getTime() - durationMs), previousTo: from };
}

/** Pourcentage de croissance, nul si la période précédente n'est pas comparable (zéro ou absente). */
export function growthPercent(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Part en pourcentage d'un élément sur un total, 0 si le total est nul (jamais de division par zéro). */
export function contributionPercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10; // 1 décimale
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

/** Jour de semaine local (0=lundi..6=dimanche) et heure locale (0-23) d'un instant, dans le fuseau donné. */
export function localDayOfWeekAndHour(instant: Date, timeZone: string): { dayOfWeek: number; hour: number } {
  const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(instant),
  );
  return { dayOfWeek: WEEKDAY_INDEX[weekdayShort] ?? 0, hour };
}
