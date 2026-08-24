import { mae, wape, meanBias, backtestAndSelect } from './forecast.validation';

describe('forecast.validation — métriques et sélection de modèle', () => {
  it('21. MAE : erreur absolue moyenne correcte', () => {
    expect(mae([10, 20, 30], [12, 18, 33])).toBeCloseTo((2 + 2 + 3) / 3);
  });

  it('22. WAPE : null si la somme des valeurs réelles est nulle (jamais de division par zéro)', () => {
    expect(wape([0, 0, 0], [1, 2, 3])).toBeNull();
  });

  it('WAPE : calcul correct sur dénominateur exploitable', () => {
    expect(wape([100, 100], [110, 90])).toBeCloseTo(20 / 200);
  });

  it('23. biais : positif si le modèle sur-prédit en moyenne', () => {
    expect(meanBias([10, 10], [15, 15])).toBeCloseTo(5);
    expect(meanBias([10, 10], [5, 5])).toBeCloseTo(-5);
  });

  it('6. série stable : la baseline naïve est conservée (aucun modèle ne bat significativement)', () => {
    const history = Array.from({ length: 30 }, () => 50);
    const dow = Array.from({ length: 30 }, (_, i) => i % 7);
    const { bestModel } = backtestAndSelect(history, dow, 7);
    expect(bestModel).toBe('NAIVE');
  });

  it('7. hausse nette : un modèle avec tendance est retenu plutôt que la baseline naïve', () => {
    const history = Array.from({ length: 40 }, (_, i) => 10 + i * 5);
    const dow = Array.from({ length: 40 }, (_, i) => i % 7);
    const { bestModel, metrics } = backtestAndSelect(history, dow, 10);
    const naive = metrics.find((m) => m.model === 'NAIVE')!;
    const best = metrics.find((m) => m.model === bestModel)!;
    expect(best.mae).toBeLessThanOrEqual(naive.mae);
  });

  it('10. saisonnalité hebdomadaire nette : le modèle saisonnier est compétitif', () => {
    const history: number[] = [];
    const dow: number[] = [];
    for (let w = 0; w < 12; w++) {
      for (let d = 0; d < 7; d++) {
        history.push(d === 5 ? 500 : 10); // pic samedi
        dow.push(d);
      }
    }
    const { metrics } = backtestAndSelect(history, dow, 14);
    const seasonal = metrics.find((m) => m.model === 'WEEKDAY_SEASONAL')!;
    const naive = metrics.find((m) => m.model === 'NAIVE')!;
    expect(seasonal.mae).toBeLessThan(naive.mae);
  });

  it('20. sélection du meilleur modèle : jamais un modèle pire que la baseline', () => {
    const history = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 100 : 0)); // bruit alterné
    const dow = Array.from({ length: 30 }, (_, i) => i % 7);
    const { bestModel, metrics } = backtestAndSelect(history, dow, 10);
    const naive = metrics.find((m) => m.model === 'NAIVE')!;
    const best = metrics.find((m) => m.model === bestModel)!;
    expect(best.mae).toBeLessThanOrEqual(naive.mae);
  });
});
