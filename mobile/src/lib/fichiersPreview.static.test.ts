// Static guard on app/fichiers.tsx: a failed batch-deletion preview must show an
// error + retry, never an endless "Analyse…", and must never delete blind.
//   node --test --experimental-strip-types src/lib/fichiersPreview.static.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('app/fichiers.tsx', 'utf8').toString();

test('preview failure sets a visible error state', () => {
  assert.ok(/setBatchPreviewError\(extractErrorMessage\(e\)\)/.test(src));
  assert.ok(/fichiers\.deleteBatchPreviewError/.test(src));
});

test('without a successful preview, confirm retries instead of deleting', () => {
  assert.ok(/if \(batchPreview\) void deleteBatchConfirmed\(\)/.test(src));
  assert.ok(/else if \(confirmBatch\) void openDeleteBatch\(confirmBatch\)/.test(src));
});

test('error state is cleared on cancel and on each new analysis', () => {
  const resets = src.match(/setBatchPreviewError\(null\)/g) ?? [];
  assert.ok(resets.length >= 2);
});
