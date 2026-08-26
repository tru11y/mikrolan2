import {
  naiveForecast,
  movingAverageForecast,
  weekdaySeasonalForecast,
  linearTrendForecast,
  clampNonNegative,
} from './forecast.models';

describe('forecast.models — modèles purs', () => {
  it('14. baseline naïve : répète la dernière valeur observée', () => {
    expect(naiveForecast([10, 20, 30], 3)).toEqual([30, 30, 30]);
  });

  it('naive sur historique vide renvoie 0', () => {
    expect(naiveForecast([], 2)).toEqual([0, 0]);
  });

  it('15. moyenne mobile 7 : moyenne des 7 dernières valeurs', () => {
    const history = [1, 2, 3, 4, 5, 6, 7, 100]; // fenêtre 7 -> derniers 7 = [2..7,100]
    const result = movingAverageForecast(history, 1, 7);
    const expected = (2 + 3 + 4 + 5 + 6 + 7 + 100) / 7;
    expect(result[0]).toBeCloseTo(expected);
  });

  it('16. moyenne mobile 14 : fenêtre plus longue lisse davantage', () => {
    const history = Array.from({ length: 20 }, (_, i) => i);
    const ma7 = movingAverageForecast(history, 1, 7)[0];
    const ma14 = movingAverageForecast(history, 1, 14)[0];
    expect(ma14).toBeLessThan(ma7); // tendance croissante -> fenêtre longue tire vers le bas
  });

  it('17. moyenne mobile 28 avec historique plus court que la fenêtre : moyenne sur tout l\'historique', () => {
    const history = [10, 20, 30];
    const result = movingAverageForecast(history, 1, 28);
    expect(result[0]).toBeCloseTo(20);
  });

  it('18. saisonnalité hebdomadaire : moyenne par jour de semaine correspondant', () => {
    // dow 0 (lundi) vaut toujours 100, dow 1 (mardi) vaut toujours 10.
    const history = [100, 10, 100, 10];
    const dow = [0, 1, 0, 1];
    const result = weekdaySeasonalForecast(history, dow, [0, 1]);
    expect(result).toEqual([100, 10]);
  });

  it('19. tendance linéaire : extrapolation correcte sur une série parfaitement linéaire', () => {
    const history = [0, 2, 4, 6, 8]; // pente 2
    const result = linearTrendForecast(history, 2);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(12);
  });

  it('tendance linéaire sur historique constant : pente nulle, prédiction stable', () => {
    const history = [50, 50, 50, 50];
    const result = linearTrendForecast(history, 3);
    expect(result.every((v) => Math.abs(v - 50) < 1e-9)).toBe(true);
  });

  it('27. clampNonNegative supprime toute valeur négative ou non finie', () => {
    expect(clampNonNegative([-5, 0, 10, NaN, Infinity])).toEqual([0, 0, 10, 0, 0]);
  });
});
