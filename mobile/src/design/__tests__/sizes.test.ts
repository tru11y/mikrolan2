// MikroLan Connect — Garanties de dimensions D0 §F : cibles tactiles >= 44.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectSize } from '../tokens/sizes.ts';

test('toutes les cibles tactiles >= 44', () => {
  for (const [k, v] of Object.entries(connectSize)) {
    if (k === 'heroIconGlyph') continue; // glyphe à l'intérieur d'un cercle, pas une cible
    assert.ok(v >= 44, `${k}=${v} doit être >= 44 pt`);
  }
});

test('CTA : 48 et 52 disponibles', () => {
  assert.equal(connectSize.btnSm, 48);
  assert.equal(connectSize.btnMd, 52);
});

test('ligne compacte 56, ligne routeur 76', () => {
  assert.equal(connectSize.listCompact, 56);
  assert.equal(connectSize.listRouter, 76);
});
