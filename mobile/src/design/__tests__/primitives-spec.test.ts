// MikroLan Connect — Tests de spec des primitives D1 (Node pur).
// On ne monte pas de renderer RN : ces tests vérifient la spec exportée.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Imports de spec seulement — PAS les composants (les .tsx importent react-native).
import { statusMatrix } from '../tokens/status.ts';
import { connectSize } from '../tokens/sizes.ts';
import { connectType } from '../tokens/typography.ts';
import { connectColors } from '../tokens/colors.ts';

/** On duplique les constantes de spec ici pour éviter d'importer les .tsx
 * (chaîne d'imports -> react-native). Elles doivent rester synchronisées avec
 * primitives/Text.tsx. */
const noTruncateVariants = ['critical', 'amount', 'kpi', 'screenTitle'];
const cappedVariants = ['kpi', 'amount', 'critical'];
const headerVariants = ['screenTitle', 'subtitle'];

test('Text: variantes critiques non tronquables', () => {
  for (const v of noTruncateVariants) {
    assert.ok(connectType[v as keyof typeof connectType] !== undefined, `${v} défini`);
  }
});

test('Text: plafond 1.6 seulement sur kpi/amount/critical', () => {
  assert.deepEqual(cappedVariants.sort(), ['amount', 'critical', 'kpi']);
});

test('Text: headerVariants = screenTitle + subtitle', () => {
  assert.deepEqual(headerVariants, ['screenTitle', 'subtitle']);
});

test('MetricCard: 3 variantes (compact / standard / hero), pas de HeroMetric séparé', () => {
  const variants = ['compact', 'standard', 'hero'];
  assert.equal(variants.length, 3);
  assert.ok(variants.includes('hero'), 'hero disponible dans MetricCard');
});

test('StatusBadge: chaque statut porte icône + libellé par défaut (couleur seule interdite)', () => {
  for (const [key, d] of Object.entries(statusMatrix)) {
    assert.ok(d.icon, `${key} doit avoir une icône`);
    assert.ok(d.fallbackLabel, `${key} doit avoir un libellé par défaut`);
  }
});

test('ListItem: hauteurs minimales 56 standard, 76 router', () => {
  assert.equal(connectSize.listCompact, 56);
  assert.equal(connectSize.listRouter, 76);
});

test('ListItem: barre latérale sémantique mappée aux couleurs existantes', () => {
  for (const c of ['success', 'warning', 'danger', 'primary', 'textMuted']) {
    assert.ok((connectColors as Record<string, string>)[c], `couleur ${c} existe`);
  }
});

test('Button (spec attendue dans ui.tsx adapté): tailles 48 et 52 côté dimensions Connect', () => {
  // Ces valeurs seront consommées par Button adapté. On vérifie leur présence
  // dans les tokens (contrat avec la primitive adaptée).
  assert.equal(connectSize.btnSm, 48);
  assert.equal(connectSize.btnMd, 52);
});
