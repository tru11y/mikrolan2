// Bornes de période calendaire (jour/semaine/mois) dans le fuseau du tenant,
// converties en instants UTC — sans dépendance externe (Intl natif Node ≥18
// suffit, voir audit/51 §6 et audit/52 §9 : Node 24 dispo, aucune lib requise).

const DEFAULT_TIMEZONE = 'Africa/Abidjan';

/** Valide un identifiant IANA via la liste réellement supportée par ce runtime Node. */
export function isValidIanaTimezone(tz: string): boolean {
  try {
    return Intl.supportedValuesOf('timeZone').includes(tz);
  } catch {
    return false;
  }
}

export function resolveTenantTimezone(tenantTimezone: string | null | undefined): string {
  if (tenantTimezone && isValidIanaTimezone(tenantTimezone)) return tenantTimezone;
  return DEFAULT_TIMEZONE;
}

interface WallClockParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInTimezone(instant: Date, timeZone: string): WallClockParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Convertit une heure « murale » (celle qu'une horloge locale au fuseau
 * `timeZone` afficherait) en instant UTC réel. Double conversion classique
 * (celle qu'utilisent en interne les libs comme date-fns-tz) : on suppose
 * d'abord que les valeurs sont déjà UTC, on regarde ce que ça donnerait dans
 * le fuseau cible, puis on corrige par l'écart constaté.
 */
export function zonedWallClockToUtc(parts: WallClockParts, timeZone: string): Date {
  const guessUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const asSeenInTz = partsInTimezone(new Date(guessUtcMs), timeZone);
  const asSeenInTzMs = Date.UTC(
    asSeenInTz.year,
    asSeenInTz.month - 1,
    asSeenInTz.day,
    asSeenInTz.hour,
    asSeenInTz.minute,
    asSeenInTz.second,
  );
  const offsetMs = asSeenInTzMs - guessUtcMs;
  return new Date(guessUtcMs - offsetMs);
}

/** Minuit local (fuseau tenant) du jour calendaire contenant `instant`, en UTC. */
export function startOfLocalDayUtc(instant: Date, timeZone: string): Date {
  const p = partsInTimezone(instant, timeZone);
  return zonedWallClockToUtc(
    { year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

/** Lundi minuit local (fuseau tenant) de la semaine contenant `instant`, en UTC. */
export function startOfLocalWeekUtc(instant: Date, timeZone: string): Date {
  const dayStart = startOfLocalDayUtc(instant, timeZone);
  // Jour de semaine local (0=dimanche..6=samedi) au moment de dayStart.
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(
    dayStart,
  );
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const isoOffsetFromMonday = ((map[weekday] ?? 1) + 6) % 7; // lundi = 0
  return new Date(dayStart.getTime() - isoOffsetFromMonday * 24 * 60 * 60 * 1000);
}

/** Premier jour du mois calendaire local (fuseau tenant) contenant `instant`, en UTC. */
export function startOfLocalMonthUtc(instant: Date, timeZone: string): Date {
  const p = partsInTimezone(instant, timeZone);
  return zonedWallClockToUtc(
    { year: p.year, month: p.month, day: 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}
