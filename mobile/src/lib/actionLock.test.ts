// node --test --experimental-strip-types src/lib/actionLock.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActionLock } from './actionLock.ts';
import { callWithDeadline, HardTimeoutError } from './hardTimeout.ts';

test('a double tap triggers a single mutation', async () => {
  const lock = createActionLock();
  let calls = 0;
  const work = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 40));
  };
  const [a, b] = await Promise.all([lock.run(work), lock.run(work)]);
  assert.equal(calls, 1);
  assert.deepEqual([a, b], [true, false]);
});

test('the lock is released after success', async () => {
  const lock = createActionLock();
  await lock.run(async () => {});
  assert.equal(lock.locked, false);
  assert.equal(await lock.run(async () => {}), true);
});

test('the lock is released after an error', async () => {
  const lock = createActionLock();
  await assert.rejects(
    lock.run(async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(lock.locked, false);
});

test('the lock is released after a deadline timeout, so a manual retry is possible', async () => {
  const lock = createActionLock();
  await assert.rejects(
    lock.run(async () => {
      await callWithDeadline(() => new Promise<never>(() => {}), 40);
    }),
    (e: unknown) => e instanceof HardTimeoutError,
  );
  assert.equal(lock.locked, false);
  let retried = false;
  assert.equal(
    await lock.run(async () => {
      retried = true;
    }),
    true,
  );
  assert.equal(retried, true);
});
