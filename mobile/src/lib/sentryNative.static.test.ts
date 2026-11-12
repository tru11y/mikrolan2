import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
