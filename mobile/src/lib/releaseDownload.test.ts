import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtBytes,
  installedState,
  logFailureBlocksDownload,
  nextDownloadStep,
  parseVersionCode,
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
