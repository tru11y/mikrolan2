// Static guard on the verifier screen source: the raw backend status code
// (VALID, BLOCKED, ...) must never be rendered. This does NOT render the
// component; the real rendering is confirmed on device.
//   node --test --experimental-strip-types src/lib/verifyScreen.static.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Run from the mobile/ directory (npm run test:unit).
const src = readFileSync('app/(verifier)/verify.tsx', 'utf8').toString();

test('verify.tsx has no Pill badge component', () => {
  assert.ok(!/\bPill\b/.test(src));
});

test('verify.tsx never renders the raw status code as text or label', () => {
  assert.ok(!/\{\s*state\.result\.status\s*\}/.test(src));
  assert.ok(!/label=\{\s*state\.result\.status\s*\}/.test(src));
});

test('result title and action come from verdictView', () => {
  assert.ok(/verdictView\(result\)/.test(src));
  assert.ok(/\{state\.view\.title\}/.test(src));
  assert.ok(/\{state\.view\.actionLabel\}/.test(src));
});

test('result title is colored by the view tone', () => {
  assert.ok(/toneColor\(state\.view\.tone\)/.test(src));
});
