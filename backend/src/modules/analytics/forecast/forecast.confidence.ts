import type { ForecastConfidence } from './forecast.types';

/**
 * Confiance déterministe — jamais attribuée par intuition. Dépend
 * uniquement de règles vérifiables : couverture d'historique, volume
 * d'entraînement, qualité de validation (WAPE), horizon demandé relatif à
 * l'historique disponible.
 */
export function computeConfidence(input: {
  meetsThreshold: boolean;
  trainingPoints: number;
  minTrainingPoints: number;
  activeRatio: number; // jours actifs / jours calendaires
  wape: number | null;
  horizonDays: number;
  historyDays: number;
}): ForecastConfidence {
  if (!input.meetsThreshold) return 'INSUFFICIENT_DATA';

  // Horizon déraisonnable par rapport à l'historique disponible : la
  // prévision reste calculable mais la confiance ne peut être qu'UNAVAILABLE
  // au sens "non fiable à évaluer", jamais HIGH par défaut.
  if (input.horizonDays > input.historyDays) return 'LOW';

  if (input.wape === null) {
    // Validation non exploitable (ex. période de validation à revenu nul) :
    // se rabat sur la seule couverture, jamais HIGH sans preuve de validation.
    if (input.trainingPoints >= input.minTrainingPoints * 1.5 && input.activeRatio >= 0.5) {
      return 'MEDIUM';
    }
    return input.trainingPoints >= input.minTrainingPoints ? 'LOW' : 'UNAVAILABLE';
  }

  const strongCoverage = input.trainingPoints >= input.minTrainingPoints * 1.5 && input.activeRatio >= 0.5;
  if (input.wape <= 0.2 && strongCoverage) return 'HIGH';
  if (input.wape <= 0.4) return 'MEDIUM';
  return 'LOW';
}
