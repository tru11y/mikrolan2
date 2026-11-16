// MikroLan Connect — Contrat des adaptations Button / Card dans ui.tsx.
// On n'importe pas le composant (il référence react-native) : on lit le
// fichier en texte et on vérifie la présence des nouvelles variantes et des
// garanties d'accessibilité.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const ui = readFileSync(
  fileURLToPath(new URL('../../components/ui.tsx', import.meta.url)),
  'utf-8',
);

test('Button: déclare les variantes accent et secondary', () => {
  assert.match(ui, /variant\?:\s*'primary'\s*\|\s*'ghost'\s*\|\s*'danger'\s*\|\s*'gold'\s*\|\s*'accent'\s*\|\s*'secondary'/);
});

test('Button: accepte size "sm" | "md" (48 / 52)', () => {
  assert.match(ui, /size\?:\s*'sm'\s*\|\s*'md'/);
});

test('Button: accessibilityLabel toujours défini (fallback sur title)', () => {
  assert.match(ui, /accessibilityLabel=\{accessibilityLabel \?\? title\}/);
});

test('Press: expose accessibilityState.busy', () => {
  assert.match(ui, /accessibilityState=\{\{ disabled: Boolean\(disabled\), busy: Boolean\(busy\) \}\}/);
});

test('Button: passe busy=loading au Press', () => {
  assert.match(ui, /busy=\{loading\}/);
});

test('Card: déclare variant default|alt|hero|critical', () => {
  assert.match(ui, /variant\?:\s*'default'\s*\|\s*'alt'\s*\|\s*'hero'\s*\|\s*'critical'/);
});

test('Card: déclare density confort|compact', () => {
  assert.match(ui, /density\?:\s*'confort'\s*\|\s*'compact'/);
});

test('Card: rendu legacy préservé sans variant/density', () => {
  assert.match(ui, /if \(!variant && !density\) return <View style=\{\[s\.card, style\]\}>/);
});

test('ui.tsx: importe les tokens Connect depuis @/src/design', () => {
  assert.match(ui, /from '@\/src\/design\/tokens\/colors'/);
  assert.match(ui, /from '@\/src\/design\/tokens\/radius'/);
  assert.match(ui, /from '@\/src\/design\/tokens\/sizes'/);
});

// theme-provider.tsx : useConnectTheme ajouté sans toucher aux exports existants.
const theme = readFileSync(
  fileURLToPath(new URL('../../providers/theme-provider.tsx', import.meta.url)),
  'utf-8',
);
test('theme-provider: expose useConnectTheme et connectTheme', () => {
  assert.match(theme, /export function useConnectTheme\(\)/);
  assert.match(theme, /export \{ connectColors as connectTheme \}/);
});
test('theme-provider: exports legacy intacts', () => {
  for (const sym of ['ThemeMode', 'ThemeColors', 'darkColors', 'lightColors', 'ThemeProvider', 'useTheme', 'useThemeMode']) {
    assert.match(theme, new RegExp(`export (?:type |function |const |\\{[^}]*\\b)${sym}\\b`), `${sym} export préservé`);
  }
});
