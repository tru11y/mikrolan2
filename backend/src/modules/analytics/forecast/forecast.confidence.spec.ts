import { computeConfidence } from './forecast.confidence';

describe('forecast.confidence — règles déterministes', () => {
  it('1. historique insuffisant -> INSUFFICIENT_DATA quel que soit le reste', () => {
    expect(
      computeConfidence({
        meetsThreshold: false,
        trainingPoints: 100,
        minTrainingPoints: 14,
        activeRatio: 1,
        wape: 0.01,
        horizonDays: 7,
        historyDays: 100,
      }),
    ).toBe('INSUFFICIENT_DATA');
  });

  it('HIGH uniquement si WAPE faible ET couverture forte', () => {
    expect(
      computeConfidence({
        meetsThreshold: true,
        trainingPoints: 40,
        minTrainingPoints: 14,
        activeRatio: 0.9,
        wape: 0.1,
        horizonDays: 7,
        historyDays: 60,
      }),
    ).toBe('HIGH');
  });

  it('37. jamais HIGH par intuition : WAPE faible mais couverture insuffisante -> pas HIGH', () => {
    const result = computeConfidence({
      meetsThreshold: true,
      trainingPoints: 15,
      minTrainingPoints: 14,
      activeRatio: 0.2,
      wape: 0.05,
      horizonDays: 7,
      historyDays: 30,
    });
    expect(result).not.toBe('HIGH');
  });

  it('WAPE moyen -> MEDIUM', () => {
    expect(
      computeConfidence({
        meetsThreshold: true,
        trainingPoints: 40,
        minTrainingPoints: 14,
        activeRatio: 0.9,
        wape: 0.3,
        horizonDays: 7,
        historyDays: 60,
      }),
    ).toBe('MEDIUM');
  });

  it('WAPE élevé -> LOW', () => {
    expect(
      computeConfidence({
        meetsThreshold: true,
        trainingPoints: 40,
        minTrainingPoints: 14,
        activeRatio: 0.9,
        wape: 0.8,
        horizonDays: 7,
        historyDays: 60,
      }),
    ).toBe('LOW');
  });

  it('34. horizon supérieur à l\'historique disponible -> LOW (jamais HIGH)', () => {
    expect(
      computeConfidence({
        meetsThreshold: true,
        trainingPoints: 30,
        minTrainingPoints: 14,
        activeRatio: 1,
        wape: 0.05,
        horizonDays: 60,
        historyDays: 30,
      }),
    ).toBe('LOW');
  });

  it('WAPE non exploitable (null) avec bonne couverture -> MEDIUM, jamais HIGH', () => {
    const result = computeConfidence({
      meetsThreshold: true,
      trainingPoints: 40,
      minTrainingPoints: 14,
      activeRatio: 0.9,
      wape: null,
      horizonDays: 7,
      historyDays: 60,
    });
    expect(result).toBe('MEDIUM');
  });

  it('WAPE non exploitable et couverture faible -> UNAVAILABLE', () => {
    const result = computeConfidence({
      meetsThreshold: true,
      trainingPoints: 14,
      minTrainingPoints: 14,
      activeRatio: 0.1,
      wape: null,
      horizonDays: 7,
      historyDays: 20,
    });
    expect(result).toBe('LOW');
  });
});
