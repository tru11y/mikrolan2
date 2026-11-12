import test from 'node:test';
import assert from 'node:assert/strict';
import { applySentry, buildSentryOptions } from './sentryConfig.ts';

const base = { dsn: 'https://k@o0.ingest.example/1', env: undefined, isDev: false, packageName: 'com.mikrolan.app', version: '1.2.0', versionCode: 45 };

test('sans DSN : aucune initialisation', () => {
  let calls = 0;
  assert.equal(buildSentryOptions({ ...base, dsn: undefined }), null);
  assert.equal(applySentry(() => calls++, { ...base, dsn: '' }), false);
  assert.equal(calls, 0);
});
test('production : traces 0.05, profiling 0, replay 0, pii off, pas de capture d’écran ni de vues', () => {
  const o = buildSentryOptions(base)!;
  assert.equal(o.environment, 'production');
  assert.equal(o.tracesSampleRate, 0.05);
  assert.equal(o.profilesSampleRate, 0);
  assert.equal(o.replaysSessionSampleRate, 0);
  assert.equal(o.replaysOnErrorSampleRate, 0);
  assert.equal(o.sendDefaultPii, false);
  assert.equal(o.attachScreenshot, false);
  assert.equal(o.attachViewHierarchy, false);
  assert.equal(o.debug, false);
});
test('staging et devtest : 0.2 explicite ; environnement inconnu → production', () => {
  assert.equal(buildSentryOptions({ ...base, env: 'staging' })!.tracesSampleRate, 0.2);
  assert.equal(buildSentryOptions({ ...base, env: 'devtest' })!.environment, 'devtest');
  assert.equal(buildSentryOptions({ ...base, env: 'bidon' })!.environment, 'production');
  assert.equal(buildSentryOptions({ ...base, env: undefined, isDev: true })!.environment, 'development');
});
test('release et dist dérivés de la configuration construite', () => {
  const o = buildSentryOptions({ ...base, packageName: 'com.mikrolan.app.devtest', version: '1.3.1', versionCode: 99 })!;
  assert.equal(o.release, 'com.mikrolan.app.devtest@1.3.1+99');
  assert.equal(o.dist, '99');
});
test('DSN présent : initialisation une seule fois', () => {
  let calls = 0;
  assert.equal(applySentry(() => calls++, base), true);
  assert.equal(applySentry(() => calls++, base), false);
  assert.equal(calls, 1);
});
