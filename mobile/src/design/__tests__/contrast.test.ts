// MikroLan Connect — Ratios WCAG 2.2 D0 §D.
// Calcul par luminance relative, seuil 4,5 texte normal / 3 composants.
// `divider` est explicitement décoratif (D0 §D) : testé à 1,5:1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectColors } from '../tokens/colors.ts';

function lin(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 0xff)
       + 0.7152 * lin((n >> 8) & 0xff)
       + 0.0722 * lin(n & 0xff);
}
function ratio(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  const hi = Math.max(x, y), lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
}

type Pair = { label: string; fg: keyof typeof connectColors; bg: keyof typeof connectColors; threshold: number };
const pairs: Pair[] = [
  { label: 'text / background',          fg: 'text',       bg: 'background', threshold: 4.5 },
  { label: 'text / surface',             fg: 'text',       bg: 'surface',    threshold: 4.5 },
  { label: 'textMuted / background',     fg: 'textMuted',  bg: 'background', threshold: 4.5 },
  { label: 'textMuted / surface',        fg: 'textMuted',  bg: 'surface',    threshold: 4.5 },
  { label: 'textFaint / background',     fg: 'textFaint',  bg: 'background', threshold: 4.5 },
  { label: 'onPrimary / primary',        fg: 'onPrimary',  bg: 'primary',    threshold: 4.5 },
  { label: 'onAccent / accent',          fg: 'onAccent',   bg: 'accent',     threshold: 4.5 },
  { label: 'primary / background',       fg: 'primary',    bg: 'background', threshold: 4.5 },
  { label: 'primary / primaryTint',      fg: 'primary',    bg: 'primaryTint',threshold: 4.5 },
  { label: 'success / successBg',        fg: 'success',    bg: 'successBg',  threshold: 4.5 },
  { label: 'warning / warningBg',        fg: 'warning',    bg: 'warningBg',  threshold: 4.5 },
  { label: 'danger / dangerBg',          fg: 'danger',     bg: 'dangerBg',   threshold: 4.5 },
  { label: 'border / surface',           fg: 'border',     bg: 'surface',    threshold: 3   },
  { label: 'border / background',        fg: 'border',     bg: 'background', threshold: 3   },
  { label: 'focus / surface',            fg: 'focus',      bg: 'surface',    threshold: 3   },
  { label: 'accent / background (fill)', fg: 'accent',     bg: 'background', threshold: 3   },
  { label: 'success (icône) / surface',  fg: 'success',    bg: 'surface',    threshold: 3   },
  { label: 'warning (icône) / surface',  fg: 'warning',    bg: 'surface',    threshold: 3   },
  { label: 'danger  (icône) / surface',  fg: 'danger',     bg: 'surface',    threshold: 3   },
];

for (const p of pairs) {
  test(`contraste ${p.label} >= ${p.threshold}:1`, () => {
    const r = ratio(connectColors[p.fg], connectColors[p.bg]);
    assert.ok(
      r >= p.threshold,
      `${p.label}: ${r.toFixed(2)}:1 < ${p.threshold}:1 (fg=${connectColors[p.fg]} bg=${connectColors[p.bg]})`,
    );
  });
}

test('divider est décoratif (sous 3:1) — règle D0 : jamais porteur d\'information', () => {
  const r = ratio(connectColors.divider, connectColors.surface);
  assert.ok(r < 3, `divider ${r.toFixed(2)}:1 confirme son usage décoratif seul`);
});
