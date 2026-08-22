import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMetricsCsvRows, csvCell, rowsToCsv } from './metricsCsvRows.ts';
import type { MetricsSummary } from './api.ts';

// Exécuté par le runtime TypeScript natif de Node (>=22, sans flag sur
// Node 24) — aucune dépendance de test à installer côté mobile
// (audit/56 §7, audit/57 étape 5) :
//   node --test src/lib/metricsCsvRows.test.ts

const HISTORICAL_ROWS = [
  ['Rapport de ventes WiFi', 'Ce Mois'],
  [],
  ['Chiffre d’affaires (FCFA)', 12000],
  ['Tickets vendus', 40],
  ['Tickets utilisés', 24],
  ['Sessions actives', 3],
  ['Tendance vs période précédente (%)', 12],
  [],
  ['Forfait', 'Tickets', 'Revenu (FCFA)'],
];

function baseSummary(overrides: Partial<MetricsSummary> = {}): MetricsSummary {
  return {
    period: '30d',
    revenueXof: 12000,
    ticketsGenerated: 40,
    ticketsUsed: 24,
    activeSessions: 3,
    previousRevenueXof: 10000,
    trendPct: 12,
    byPlan: [
      { planId: 'p1', planName: '1h', priceXof: 500, sold: 20, revenueXof: 10000 },
      { planId: 'p2', planName: '3h', priceXof: 1000, sold: 2, revenueXof: 2000 },
    ],
    ...overrides,
  } as MetricsSummary;
}

test('ancien payload (sans champs qualité) : lignes historiques présentes, dans l’ordre, aucune section qualité', () => {
  const rows = buildMetricsCsvRows(baseSummary(), 'Ce Mois');
  assert.deepEqual(rows.slice(0, HISTORICAL_ROWS.length), HISTORICAL_ROWS);
  assert.deepEqual(rows[9], ['1h', 20, 10000]);
  assert.deepEqual(rows[10], ['3h', 2, 2000]);
  assert.equal(rows.length, 11); // aucune section qualité ajoutée
});

test('libellés historiques inchangés mot pour mot', () => {
  const rows = buildMetricsCsvRows(baseSummary(), 'Ce Mois');
  assert.equal(rows[0][0], 'Rapport de ventes WiFi');
  assert.equal(rows[2][0], 'Chiffre d’affaires (FCFA)');
  assert.equal(rows[3][0], 'Tickets vendus');
  assert.equal(rows[4][0], 'Tickets utilisés');
  assert.equal(rows[5][0], 'Sessions actives');
  assert.equal(rows[6][0], 'Tendance vs période précédente (%)');
  assert.deepEqual(rows[8], ['Forfait', 'Tickets', 'Revenu (FCFA)']);
});

test('tableau par forfait toujours identifiable par son en-tête, position logique préservée juste après le bloc résumé', () => {
  const rows = buildMetricsCsvRows(baseSummary(), 'Ce Mois');
  const headerIdx = rows.findIndex(
    (r) => r[0] === 'Forfait' && r[1] === 'Tickets' && r[2] === 'Revenu (FCFA)',
  );
  assert.equal(headerIdx, 8);
  assert.deepEqual(rows[headerIdx + 1], ['1h', 20, 10000]);
});

test('nouveau payload EXACT : section qualité ajoutée après le bloc historique, bloc historique intact', () => {
  const data = baseSummary({
    dataQuality: 'EXACT',
    exactRevenueXof: 12000,
    estimatedRevenueXof: 0,
    unknownSalesCount: 0,
    invalidSourceCount: 0,
  });
  const rows = buildMetricsCsvRows(data, 'Ce Mois');
  assert.deepEqual(rows.slice(0, HISTORICAL_ROWS.length), HISTORICAL_ROWS);
  const qualityHeaderIdx = rows.findIndex((r) => r[0] === 'Qualité des données');
  assert.ok(qualityHeaderIdx > 10); // strictement après le tableau par forfait
  assert.deepEqual(rows[qualityHeaderIdx + 1], ['Qualité', 'EXACT']);
  assert.deepEqual(rows[qualityHeaderIdx + 2], ['Revenu exact (FCFA)', 12000]);
  assert.deepEqual(rows[qualityHeaderIdx + 3], ['Revenu estimé (FCFA)', 0]);
});

test('payload ESTIMATED : section qualité correcte, aucun undefined/NaN', () => {
  const data = baseSummary({
    dataQuality: 'ESTIMATED',
    exactRevenueXof: 0,
    estimatedRevenueXof: 12000,
    unknownSalesCount: 0,
    invalidSourceCount: 0,
  });
  const rows = buildMetricsCsvRows(data, 'Ce Mois');
  const csv = rowsToCsv(rows);
  assert.ok(!csv.includes('undefined'));
  assert.ok(!csv.includes('NaN'));
  assert.ok(!csv.includes('null'));
  const qualityRow = rows.find((r) => r[0] === 'Qualité');
  assert.deepEqual(qualityRow, ['Qualité', 'ESTIMATED']);
});

test('payload MIXED : revenu exact et estimé tous deux non nuls, présents et non NaN', () => {
  const data = baseSummary({
    dataQuality: 'MIXED',
    exactRevenueXof: 7000,
    estimatedRevenueXof: 5000,
    unknownSalesCount: 0,
    invalidSourceCount: 0,
  });
  const rows = buildMetricsCsvRows(data, 'Ce Mois');
  assert.deepEqual(rows.find((r) => r[0] === 'Revenu exact (FCFA)'), ['Revenu exact (FCFA)', 7000]);
  assert.deepEqual(rows.find((r) => r[0] === 'Revenu estimé (FCFA)'), ['Revenu estimé (FCFA)', 5000]);
});

test('payload INCOMPLETE : ventes inconnues et données invalides comptées, pas de undefined/NaN', () => {
  const data = baseSummary({
    dataQuality: 'INCOMPLETE',
    exactRevenueXof: 5000,
    estimatedRevenueXof: 0,
    unknownSalesCount: 3,
    invalidSourceCount: 2,
  });
  const rows = buildMetricsCsvRows(data, 'Ce Mois');
  assert.deepEqual(
    rows.find((r) => r[0] === 'Ventes de provenance inconnue'),
    ['Ventes de provenance inconnue', 3],
  );
  assert.deepEqual(rows.find((r) => r[0] === 'Données invalides'), ['Données invalides', 2]);
  const csv = rowsToCsv(rows);
  assert.ok(!csv.includes('undefined'));
  assert.ok(!csv.includes('NaN'));
});

test('champs qualité manquants individuellement (transition de version) : repli 0, jamais undefined', () => {
  const data = baseSummary({ dataQuality: 'MIXED' }); // exact/estimated/unknown/invalid omis
  const rows = buildMetricsCsvRows(data, 'Ce Mois');
  const csv = rowsToCsv(rows);
  assert.ok(!csv.includes('undefined'));
  assert.deepEqual(rows.find((r) => r[0] === 'Revenu exact (FCFA)'), ['Revenu exact (FCFA)', 0]);
});

test('échappement CSV inchangé : guillemets, points-virgules, retours ligne', () => {
  assert.equal(csvCell('simple'), 'simple');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell('a\nb'), '"a\nb"');
  assert.equal(csvCell(1234), '1234');
});

test('montants entiers préservés (jamais convertis en flottant/chaîne inutilement)', () => {
  const rows = buildMetricsCsvRows(baseSummary(), 'Ce Mois');
  assert.equal(typeof rows[2][1], 'number');
  assert.equal(Number.isInteger(rows[2][1] as number), true);
});
