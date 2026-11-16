// MikroLan Connect — Tests d'exactitude des tokens D0.
// Node pur, sans React Native. Vérifie que chaque token exigé par D0 est
// présent avec la valeur correcte.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectColors } from '../tokens/colors.ts';
import {
  connectType,
  connectLineHeight,
  connectWeight,
  connectMaxFontMultiplier,
  connectFontFamily,
} from '../tokens/typography.ts';
import { connectSpace } from '../tokens/spacing.ts';
import { connectRadius } from '../tokens/radius.ts';
import { connectSize } from '../tokens/sizes.ts';
import { connectIcon } from '../tokens/icon.ts';

test('colors: toutes les clés D0 présentes avec la valeur exacte', () => {
  const expected = {
    background: '#FBF6EE', surface: '#FFFFFF', surfaceAlt: '#F5EEDF',
    text: '#1F2A28', textMuted: '#4F5B58', textFaint: '#585F5C',
    border: '#9E8A5A', borderSoft: '#9E8A5A', divider: '#E3D8C5',
    primary: '#0B6B5C', primaryHover: '#095548', onPrimary: '#FFFFFF',
    primaryTint: '#DDF0EA', accent: '#B35C00', onAccent: '#FFFFFF',
    accentTint: '#FFE9C2', success: '#0F6B2E', successBg: '#DFF2E6',
    warning: '#7A4300', warningBg: '#FFE2B3', danger: '#A8221A',
    dangerBg: '#FCE2DF', focus: '#0B6B5C',
  } as const;
  for (const [k, v] of Object.entries(expected)) {
    assert.equal((connectColors as Record<string, string>)[k], v, `${k} doit valoir ${v}`);
  }
});

test('typographie: échelle unique D0 §E', () => {
  assert.equal(connectType.micro, 12);
  assert.equal(connectType.secondary, 14);
  assert.equal(connectType.body, 16);
  assert.equal(connectType.button, 16);
  assert.equal(connectType.subtitle, 18);
  assert.equal(connectType.screenTitle, 24);
  assert.equal(connectType.critical, 24);
  assert.equal(connectType.kpi, 30);
  assert.equal(connectType.amount, 40);
});

test('typographie: plancher 12 — aucune valeur entre 7 et 11 pt', () => {
  for (const [k, v] of Object.entries(connectType)) {
    assert.ok(v >= 12, `${k}=${v} doit être >= 12 pt (D0 §E)`);
  }
});

test('typographie: lineHeight défini pour chaque variante', () => {
  for (const k of Object.keys(connectType)) {
    assert.ok(
      (connectLineHeight as Record<string, number>)[k] > 0,
      `lineHeight.${k} doit être défini`,
    );
  }
});

test('typographie: plafonds de font-scaling uniquement sur kpi/amount/critical', () => {
  assert.equal(connectMaxFontMultiplier.kpi, 1.6);
  assert.equal(connectMaxFontMultiplier.amount, 1.6);
  assert.equal(connectMaxFontMultiplier.critical, 1.6);
  assert.equal(Object.keys(connectMaxFontMultiplier).length, 3, 'exactement 3 variantes plafonnées');
});

test('typographie: pile système (fontFamily.base undefined)', () => {
  assert.equal(connectFontFamily.base, undefined);
  assert.equal(connectFontFamily.mono, 'monospace');
});

test('typographie: graisses disponibles', () => {
  for (const w of ['regular','medium','semibold','bold','heavy'] as const) {
    assert.ok((connectWeight as Record<string, string>)[w], `weight.${w} doit exister`);
  }
});

test('espacement: base 4 pt', () => {
  const expected = { xs:4, sm:8, md:12, lg:16, xl:20, xxl:24, xxxl:32 };
  for (const [k, v] of Object.entries(expected)) {
    assert.equal((connectSpace as Record<string, number>)[k], v);
  }
  for (const v of Object.values(connectSpace)) {
    assert.equal(v % 4, 0, `${v} doit être multiple de 4`);
  }
});

test('rayons: échelle D0 (lg=16, xl=20)', () => {
  assert.deepEqual(
    { xs: connectRadius.xs, sm: connectRadius.sm, md: connectRadius.md,
      lg: connectRadius.lg, xl: connectRadius.xl, pill: connectRadius.pill },
    { xs:4, sm:8, md:12, lg:16, xl:20, pill:999 },
  );
});

test('dimensions: cible tactile >= 44, CTA 48/52', () => {
  assert.equal(connectSize.tap, 44);
  assert.equal(connectSize.btnSm, 48);
  assert.equal(connectSize.btnMd, 52);
  assert.equal(connectSize.listCompact, 56);
  assert.equal(connectSize.listRouter, 76);
  assert.ok(connectSize.tap >= 44);
});

test('icônes: tailles D0', () => {
  assert.deepEqual(
    { xs: connectIcon.xs, sm: connectIcon.sm, md: connectIcon.md,
      lg: connectIcon.lg, xl: connectIcon.xl, hero: connectIcon.hero },
    { xs:14, sm:16, md:20, lg:24, xl:28, hero:60 },
  );
});
