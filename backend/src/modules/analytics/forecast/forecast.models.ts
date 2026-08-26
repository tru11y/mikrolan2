import type { ForecastModelName } from './forecast.types';

/**
 * Modèles de prévision explicables — fonctions pures TypeScript, aucune
 * dépendance externe, aucun ML. Chaque modèle prend un historique
 * chronologique de valeurs numériques (`history`, index 0 = plus ancien) et
 * un horizon (nombre de points à prévoir), et renvoie `horizon` valeurs.
 * Le "point à prévoir" j est toujours prédit à partir de l'historique
 * disponible strictement avant lui (jamais de fuite du futur).
 */

export function naiveForecast(history: number[], horizon: number): number[] {
  const last = history.length ? history[history.length - 1] : 0;
  return Array.from({ length: horizon }, () => last);
}

function movingAverage(history: number[], window: number): number {
  if (history.length === 0) return 0;
  const slice = history.slice(-window);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

export function movingAverageForecast(history: number[], horizon: number, window: number): number[] {
  const avg = movingAverage(history, window);
  return Array.from({ length: horizon }, () => avg);
}

/**
 * Moyenne des valeurs historiques du même jour de semaine que chaque point
 * à prévoir. `historyDayOfWeek[i]` correspond à `history[i]`.
 * `targetDayOfWeek[h]` est le jour de semaine du h-ième point d'horizon.
 */
export function weekdaySeasonalForecast(
  history: number[],
  historyDayOfWeek: number[],
  targetDayOfWeek: number[],
): number[] {
  const byDow = new Map<number, number[]>();
  for (let i = 0; i < history.length; i++) {
    const dow = historyDayOfWeek[i];
    const arr = byDow.get(dow) ?? [];
    arr.push(history[i]);
    byDow.set(dow, arr);
  }
  const fallback = movingAverage(history, history.length);
  return targetDayOfWeek.map((dow) => {
    const values = byDow.get(dow);
    if (!values || values.length === 0) return fallback;
    return values.reduce((s, v) => s + v, 0) / values.length;
  });
}

/** Régression linéaire simple (moindres carrés) sur l'index chronologique. */
export function linearTrendForecast(history: number[], horizon: number): number[] {
  const n = history.length;
  if (n === 0) return Array.from({ length: horizon }, () => 0);
  if (n === 1) return Array.from({ length: horizon }, () => history[0]);

  const xs = Array.from({ length: n }, (_, i) => i);
  const xMean = xs.reduce((s, v) => s + v, 0) / n;
  const yMean = history.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (history[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;

  return Array.from({ length: horizon }, (_, h) => {
    const x = n + h;
    const y = intercept + slope * x;
    return Number.isFinite(y) ? y : 0;
  });
}

export function runModel(
  model: ForecastModelName,
  history: number[],
  historyDayOfWeek: number[],
  horizon: number,
  targetDayOfWeek: number[],
): number[] {
  switch (model) {
    case 'NAIVE':
      return naiveForecast(history, horizon);
    case 'MOVING_AVERAGE_7':
      return movingAverageForecast(history, horizon, 7);
    case 'MOVING_AVERAGE_14':
      return movingAverageForecast(history, horizon, 14);
    case 'MOVING_AVERAGE_28':
      return movingAverageForecast(history, horizon, 28);
    case 'WEEKDAY_SEASONAL':
      return weekdaySeasonalForecast(history, historyDayOfWeek, targetDayOfWeek);
    case 'LINEAR_TREND':
      return linearTrendForecast(history, horizon);
  }
}

/** Jamais de valeur négative ni non finie en sortie d'un modèle. */
export function clampNonNegative(values: number[]): number[] {
  return values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
}
