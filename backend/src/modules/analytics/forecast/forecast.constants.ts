/**
 * Seuils de données pour le moteur de prévision BI (audit/73). Centralisés
 * ici pour que "historique insuffisant" soit une décision unique et
 * cohérente à travers tous les endpoints /analytics/forecast/*.
 */
export const FORECAST_THRESHOLDS = {
  daily: {
    minCalendarDays: 28,
    minActiveDays: 14,
    minValuedActivations: 30,
  },
  weekly: {
    minWeeks: 8,
    minObservationsPerDay: 6,
  },
  hourly: {
    minCalendarDays: 28,
    minActivations: 100,
  },
} as const;

/** Fenêtre historique maximale interrogée pour toute prévision — borne la mémoire/le temps de requête. */
export const FORECAST_MAX_HISTORY_DAYS = 180;

/** Fenêtre de validation temporelle (backtest) pour le choix de modèle. */
export const FORECAST_VALIDATION_DAYS = 14;

export const DEFAULT_HORIZON_DAYS = 7;
export const MAX_HORIZON_DAYS = 30;
export const MIN_HORIZON_DAYS = 1;
