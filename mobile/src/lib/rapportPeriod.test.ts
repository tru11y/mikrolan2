import test from 'node:test';
import assert from 'node:assert/strict';
import {
  barHeights,
  fmtRange,
  growthLabel,
  lastMonth,
  monthGrid,
  orderedRange,
  rangeDays,
  thisMonth,
  toApiBounds,
} from './rapportPeriod.ts';

test('orderedRange : ordre indifférent, heures ignorées', () => {
  const r = orderedRange(new Date(2026, 10, 9, 18, 30), new Date(2026, 10, 3, 7));
  assert.equal(r.from.getDate(), 3);
  assert.equal(r.to.getDate(), 9);
  assert.equal(r.from.getHours(), 0);
  assert.equal(rangeDays(r), 7);
});

test('toApiBounds : `to` exclusif, lendemain du dernier jour, en UTC', () => {
  const b = toApiBounds({ from: new Date(2026, 10, 3), to: new Date(2026, 10, 9) });
  assert.equal(b.from, '2026-11-03T00:00:00.000Z');
  assert.equal(b.to, '2026-11-10T00:00:00.000Z');
});

test('toApiBounds : un seul jour, et passage de mois', () => {
  const b = toApiBounds({ from: new Date(2026, 10, 30), to: new Date(2026, 10, 30) });
  assert.equal(b.from, '2026-11-30T00:00:00.000Z');
  assert.equal(b.to, '2026-12-01T00:00:00.000Z');
});

test('monthGrid : lundi en premier (novembre 2026 commence un dimanche)', () => {
  const g = monthGrid(2026, 10);
  assert.deepEqual(g.slice(0, 7), [null, null, null, null, null, null, 1]);
  assert.equal(g.length, 36);
  assert.equal(g[g.length - 1], 30);
});

test('monthGrid : mois qui commence un lundi, aucune case vide', () => {
  assert.equal(monthGrid(2026, 5)[0], 1); // juin 2026
});

test('thisMonth / lastMonth', () => {
  const today = new Date(2026, 10, 17, 12);
  assert.equal(fmtRange(thisMonth(today)), '01/11/2026 – 17/11/2026');
  assert.equal(fmtRange(lastMonth(today)), '01/10/2026 – 31/10/2026');
  assert.equal(fmtRange(lastMonth(new Date(2026, 0, 5))), '01/12/2025 – 31/12/2025');
});

test('fmtRange : un seul jour sans tiret', () => {
  assert.equal(fmtRange({ from: new Date(2026, 10, 16), to: new Date(2026, 10, 16) }), '16/11/2026');
});

test('growthLabel : signe, virgule, et absence de base', () => {
  assert.deepEqual(growthLabel(11.24), { text: '+11,2 %', up: true });
  assert.deepEqual(growthLabel(-4), { text: '−4 %', up: false });
  assert.deepEqual(growthLabel(0), { text: '+0 %', up: true });
  assert.equal(growthLabel(null), null);
  assert.equal(growthLabel(Number.POSITIVE_INFINITY), null);
});

test('barHeights : échelle sur le maximum, valeur non nulle toujours visible, tout à zéro', () => {
  assert.deepEqual(barHeights([0, 50, 100], 140), [0, 70, 140]);
  assert.deepEqual(barHeights([1, 1000], 140), [2, 140]);
  assert.deepEqual(barHeights([0, 0], 140), [0, 0]);
  assert.deepEqual(barHeights([], 140), []);
});

test('meaningfulGrowth : masque les variations sans base sérieuse', async () => {
  const { meaningfulGrowth } = await import('./rapportPeriod.ts');
  assert.equal(meaningfulGrowth(-41), -41);
  assert.equal(meaningfulGrowth(300), 300);
  assert.equal(meaningfulGrowth(2817), null);
  assert.equal(meaningfulGrowth(-301), null);
  assert.equal(meaningfulGrowth(null), null);
});

test('peakIndex : première plus forte valeur, -1 si tout est nul', async () => {
  const { peakIndex } = await import('./rapportPeriod.ts');
  assert.equal(peakIndex([0, 500, 1000, 1000]), 2);
  assert.equal(peakIndex([0, 0]), -1);
  assert.equal(peakIndex([]), -1);
});

test('axisTickIndexes : toutes les 6 h, sinon début, milieu, fin', async () => {
  const { axisTickIndexes } = await import('./rapportPeriod.ts');
  assert.deepEqual(axisTickIndexes(24, true), [0, 6, 12, 18]);
  assert.deepEqual(axisTickIndexes(30, false), [0, 14, 29]);
  assert.deepEqual(axisTickIndexes(7, false), [0, 3, 6]);
  assert.deepEqual(axisTickIndexes(2, false), [0, 1]);
  assert.deepEqual(axisTickIndexes(0, false), []);
});
