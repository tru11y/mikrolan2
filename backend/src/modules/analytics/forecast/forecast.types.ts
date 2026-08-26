export type ForecastModelName =
  | 'NAIVE'
  | 'MOVING_AVERAGE_7'
  | 'MOVING_AVERAGE_14'
  | 'MOVING_AVERAGE_28'
  | 'WEEKDAY_SEASONAL'
  | 'LINEAR_TREND';

export type ForecastConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';

/** Point quotidien d'une série chronologique bornée [from, to), jours manquants explicites à 0. */
export interface DailySeriesPoint {
  date: string; // YYYY-MM-DD, jour local du tenant
  dayOfWeek: number; // 0=lundi..6=dimanche, jour local du tenant
  revenueXof: number;
  salesCount: number;
}

export interface ModelMetrics {
  model: ForecastModelName;
  mae: number;
  wape: number | null; // null si dénominateur (somme réelle) non exploitable
  bias: number;
}

export interface ForecastPoint {
  date: string;
  predicted: number;
  lowerBound: number;
  upperBound: number;
}

export interface ForecastResult {
  metric: 'revenueXof' | 'salesCount';
  points: ForecastPoint[];
  model: ForecastModelName;
  confidence: ForecastConfidence;
  historyStart: string | null;
  historyEnd: string | null;
  trainingPoints: number;
  validationMetric: { mae: number; wape: number | null; bias: number } | null;
  modelComparison: ModelMetrics[];
  calculatedAt: string;
  isForecast: true;
  warnings: string[];
}
