// node --test --experimental-strip-types src/lib/hardTimeout.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HardTimeoutError, callWithDeadline, withDeadline } from './hardTimeout.ts';

test('resolves with the value when the call finishes in time', async () => {
  const c = new AbortController();
  assert.equal(await withDeadline(Promise.resolve(42), c, 200), 42);
  assert.equal(c.signal.aborted, false);
});

test('an HTTP-style error before the deadline is propagated unchanged', async () => {
  const c = new AbortController();
  await assert.rejects(withDeadline(Promise.reject(new Error('403')), c, 200), /403/);
  assert.equal(c.signal.aborted, false);
});

test('a pending call is aborted and rejected with HardTimeoutError at the deadline', async () => {
  const c = new AbortController();
  const started = Date.now();
  await assert.rejects(
    withDeadline(new Promise<never>(() => {}), c, 60),
    (e: unknown) => e instanceof HardTimeoutError,
  );
  assert.ok(Date.now() - started < 1000);
  assert.equal(c.signal.aborted, true);
});

test('callWithDeadline passes the signal to the call and aborts it at the deadline', async () => {
  let seen: AbortSignal | undefined;
  await assert.rejects(
    callWithDeadline((signal) => {
      seen = signal;
      return new Promise<never>(() => {});
    }, 60),
    (e: unknown) => e instanceof HardTimeoutError,
  );
  assert.ok(seen);
  assert.equal(seen.aborted, true);
});

test('callWithDeadline does not abort the signal after a success (timer cleared)', async () => {
  let seen: AbortSignal | undefined;
  assert.equal(
    await callWithDeadline(async (s) => {
      seen = s;
      return 1;
    }, 50),
    1,
  );
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(seen?.aborted, false);
});

test('the timer is cleared after an error too (no late abort)', async () => {
  const c = new AbortController();
  await assert.rejects(withDeadline(Promise.reject(new Error('x')), c, 50), /x/);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(c.signal.aborted, false);
});

test('a late rejection after the deadline raises no unhandled rejection', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const c = new AbortController();
    let rejectLate: (e: Error) => void = () => {};
    const call = new Promise<never>((_, reject) => {
      rejectLate = reject;
    });
    await assert.rejects(withDeadline(call, c, 30), (e: unknown) => e instanceof HardTimeoutError);
    rejectLate(new Error('late native failure'));
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('a new attempt can start right after a timeout; a late success of the old one is ignored', async () => {
  const c1 = new AbortController();
  let resolveLate: (v: string) => void = () => {};
  const slow = new Promise<string>((resolve) => {
    resolveLate = resolve;
  });
  await assert.rejects(withDeadline(slow, c1, 30), (e: unknown) => e instanceof HardTimeoutError);
  resolveLate('late');
  assert.equal(await callWithDeadline(async () => 'fresh', 200), 'fresh');
});
