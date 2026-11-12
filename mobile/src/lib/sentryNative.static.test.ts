import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const manifest = readFileSync(join(import.meta.dirname, '..', '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');

test('SDK natif Sentry : PII, captures d’écran et breadcrumbs d’interaction désactivés dans le manifeste', () => {
  for (const key of [
    'io.sentry.send-default-pii',
    'io.sentry.attach-screenshot',
    'io.sentry.attach-view-hierarchy',
    'io.sentry.breadcrumbs.user-interaction',
    'io.sentry.breadcrumbs.system-events',
    'io.sentry.breadcrumbs.network-events',
    'io.sentry.breadcrumbs.app-components',
  ]) {
    assert.match(manifest, new RegExp(`android:name="${key.replace(/\./g, '\\.')}" android:value="false"`), key);
  }
});

test('aucun DSN Sentry dans le manifeste', () => {
  assert.equal(manifest.includes('io.sentry.dsn'), false);
});

const require = createRequire(import.meta.url);
const mobileDir = join(import.meta.dirname, '..', '..');

test('plugin Expo : enregistré dans app.json et ses clés sont celles du manifeste suivi', () => {
  const appJson = readFileSync(join(mobileDir, 'app.json'), 'utf8');
  assert.match(appJson, /\.\/plugins\/withSentryNativeHardening/);
  const { SETTINGS } = require(join(mobileDir, 'plugins', 'withSentryNativeHardening.js')) as { SETTINGS: Record<string, string> };
  const names = Object.keys(SETTINGS);
  assert.equal(names.length, 7);
  for (const name of names) {
    assert.equal(SETTINGS[name], 'false', name);
    assert.ok(manifest.includes(`android:name="${name}" android:value="false"`), `manifeste : ${name}`);
  }
});
