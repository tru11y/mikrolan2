import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtBytes,
  installedState,
  logFailureBlocksDownload,
  nextDownloadStep,
  parseVersionCode,
  resolveInstalledVersionCode,
} from './releaseDownload.ts';

// node --test src/lib/releaseDownload.test.ts
const latest = { versionCode: 40, minVersionCode: 30 };

test('installedState', () => {
  assert.equal(installedState(40, latest), 'upToDate');
  assert.equal(installedState(41, latest), 'upToDate');
  assert.equal(installedState(35, latest), 'updateAvailable');
  assert.equal(installedState(29, latest), 'updateRequired');
  assert.equal(installedState(null, latest), 'updateAvailable');
  assert.equal(installedState(39, { versionCode: 40, minVersionCode: 40 }), 'updateRequired');
});

test('parseVersionCode', () => {
  assert.equal(parseVersionCode('37'), 37);
  assert.equal(parseVersionCode(37), 37);
  assert.equal(parseVersionCode('abc'), null);
  assert.equal(parseVersionCode(undefined), null);
  assert.equal(parseVersionCode('0'), null);
});

test('fmtBytes', () => {
  assert.equal(fmtBytes(512), '512 o');
  assert.equal(fmtBytes(12 * 1024 * 1024), '12,0 Mo');
  assert.equal(fmtBytes(1536), '1,5 Ko');
  assert.equal(fmtBytes(-1), '—');
});

test('nextDownloadStep', () => {
  assert.deepEqual(nextDownloadStep({ downloadUrl: 'https://s3/x' }), { kind: 'open', url: 'https://s3/x' });
  assert.deepEqual(nextDownloadStep({ downloadUrl: null }), { kind: 'fail', reason: 'no-url' });
});

test('logFailureBlocksDownload : seuls 404/409 bloquent', () => {
  assert.equal(logFailureBlocksDownload(409), true);
  assert.equal(logFailureBlocksDownload(404), true);
  assert.equal(logFailureBlocksDownload(500), false);
  assert.equal(logFailureBlocksDownload(null), false);
});

test('version installée : le natif "39" l’emporte sur app.json 37 (bug A56)', () => {
  assert.equal(resolveInstalledVersionCode({ native: '39', config: 37 }), 39);
});

test('version installée : natif absent → repli app.json 37', () => {
  assert.equal(resolveInstalledVersionCode({ native: null, config: 37 }), 37);
  assert.equal(resolveInstalledVersionCode({ config: 37 }), 37);
});

test('version installée : ordre natif > constants > app.json', () => {
  assert.equal(resolveInstalledVersionCode({ native: '39', constantsNative: '38', config: 37 }), 39);
  assert.equal(resolveInstalledVersionCode({ native: null, constantsNative: '40', config: 37 }), 40);
});

test('version installée : source illisible ignorée, tout illisible → null (ni bannière ni blocage)', () => {
  assert.equal(resolveInstalledVersionCode({ native: 'abc', config: 37 }), 37);
  assert.equal(resolveInstalledVersionCode({ native: '0', constantsNative: '', config: undefined }), null);
  assert.equal(resolveInstalledVersionCode({}), null);
});
