import { runModel, clampNonNegative } from './forecast.models';
import type { ForecastModelName, ModelMetrics } from './forecast.types';

/** Erreur absolue moyenne. */
export function mae(actual: number[], predicted: number[]): number {
  if (actual.length === 0) return 0;
  const sum = actual.reduce((s, v, i) => s + Math.abs(v - predicted[i]), 0);
  return sum / actual.length;
}

/**
 * Weighted Absolute Percentage Error — null si la somme des valeurs réelles
 * est nulle (dénominateur non exploitable, jamais de division par zéro).
 */
export function wape(actual: number[], predicted: number[]): number | null {
  const denom = actual.reduce((s, v) => s + v, 0);
  if (denom <= 0) return null;
  const num = actual.reduce((s, v, i) => s + Math.abs(v - predicted[i]), 0);
  return num / denom;
}

/** Biais moyen (positif = sur-prédiction, négatif = sous-prédiction). */
export function meanBias(actual: number[], predicted: number[]): number {
  if (actual.length === 0) return 0;
  const sum = actual.reduce((s, v, i) => s + (predicted[i] - v), 0);
  return sum / actual.length;
}

const CANDIDATE_MODELS: ForecastModelName[] = [
  'NAIVE',
  'MOVING_AVERAGE_7',
  'MOVING_AVERAGE_14',
  'MOVING_AVERAGE_28',
  'WEEKDAY_SEASONAL',
  'LINEAR_TREND',
];

export interface BacktestResult {
  metrics: ModelMetrics[];
  bestModel: ForecastModelName;
}

/**
 * Split temporel strict (jamais aléatoire) : entraîne sur `history[0..split)`,
 * valide sur `history[split..]`. Chaque modèle est évalué en ré-entraînant
 * pas à pas (walk-forward) pour ne jamais laisser le futur influencer une
 * prédiction passée. Le modèle retenu doit battre la baseline naïve d'au
 * moins 5 % de MAE relative, sinon la baseline est conservée (règle "au
 * moins aussi stable" du mandat).
 */
export function backtestAndSelect(
  history: number[],
  historyDayOfWeek: number[],
  validationSize: number,
): BacktestResult {
  const n = history.length;
  const split = Math.max(1, n - validationSize);
  const actual = history.slice(split);
  const actualDow = historyDayOfWeek.slice(split);

  const metrics: ModelMetrics[] = CANDIDATE_MODELS.map((model) => {
    // Walk-forward : à chaque pas de validation, le modèle ne voit que
    // l'historique strictement antérieur à ce pas.
    const predicted: number[] = [];
    for (let i = split; i < n; i++) {
      const trainHistory = history.slice(0, i);
      const trainDow = historyDayOfWeek.slice(0, i);
      const [p] = runModel(model, trainHistory, trainDow, 1, [historyDayOfWeek[i]]);
      predicted.push(p);
    }
    const clamped = clampNonNegative(predicted);
    return {
      model,
      mae: mae(actual, clamped),
      wape: wape(actual, clamped),
      bias: meanBias(actual, clamped),
    };
  });

  const naive = metrics.find((m) => m.model === 'NAIVE')!;
  let best = naive;
  for (const m of metrics) {
    if (m.model === 'NAIVE') continue;
    // "réellement meilleur" : au moins 5% de MAE relative en moins que la
    // baseline, jamais un modèle plus complexe choisi pour une amélioration
    // marginale ou du bruit.
    if (naive.mae > 0 && m.mae < naive.mae * 0.95 && m.mae < best.mae) {
      best = m;
    }
  }

  void actualDow;
  return { metrics, bestModel: best.model };
}
