/** Logique pure de l'écran Rapport : périodes, bornes d'API, grille de calendrier, barres. */

/** Jours locaux, bornes incluses. */
export type DayRange = { from: Date; to: Date };

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Deux jours touchés dans n'importe quel ordre → plage ordonnée. */
export function orderedRange(a: Date, b: Date): DayRange {
  const x = startOfDay(a);
  const y = startOfDay(b);
  return x.getTime() <= y.getTime() ? { from: x, to: y } : { from: y, to: x };
}

export function rangeDays(range: DayRange): number {
  return Math.round((startOfDay(range.to).getTime() - startOfDay(range.from).getTime()) / 86_400_000) + 1;
}

/**
 * Bornes attendues par l'API analytics : datetimes ISO, `to` exclusif (lendemain du dernier jour).
 * En UTC, comme l'ancien sélecteur de mois, pour que le même jour donne la même borne partout.
 */
export function toApiBounds(range: DayRange): { from: string; to: string } {
  const { from, to } = range;
  return {
    from: new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())).toISOString(),
    to: new Date(Date.UTC(to.getFullYear(), to.getMonth(), to.getDate() + 1)).toISOString(),
  };
}

export function thisMonth(today: Date): DayRange {
  return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: startOfDay(today) };
}

export function lastMonth(today: Date): DayRange {
  return {
    from: new Date(today.getFullYear(), today.getMonth() - 1, 1),
    to: new Date(today.getFullYear(), today.getMonth(), 0),
  };
}

/** Cases d'un mois, lundi en premier ; `null` = case vide avant le 1er. */
export function monthGrid(year: number, month: number): (number | null)[] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
}

export function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export function fmtRange(range: DayRange): string {
  return sameDay(range.from, range.to) ? fmtDate(range.from) : `${fmtDate(range.from)} – ${fmtDate(range.to)}`;
}

/** « +11,2 % » / « −4 % » ; `null` quand la période précédente n'a pas de base de comparaison. */
export function growthLabel(pct: number | null | undefined): { text: string; up: boolean } | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const rounded = Math.round(Math.abs(pct) * 10) / 10;
  const digits = String(rounded).replace('.', ',');
  return { text: `${pct >= 0 ? '+' : '−'}${digits} %`, up: pct >= 0 };
}

/** Hauteurs en px ; une valeur non nulle reste visible (2 px minimum). */
export function barHeights(values: number[], maxPx: number): number[] {
  const max = Math.max(0, ...values);
  if (max === 0) return values.map(() => 0);
  return values.map((v) => (v <= 0 ? 0 : Math.max(2, Math.round((v / max) * maxPx))));
}
