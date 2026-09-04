import assert from 'node:assert/strict';
import test from 'node:test';
import { createAsyncLimiter } from '../src/youtube/concurrency.js';

test('async limiter bounds concurrency and admits queued work FIFO', async () => {
  const limit = createAsyncLimiter(2);
  const started: number[] = [];
  let active = 0;
  let peak = 0;
  const jobs = Array.from({ length: 6 }, (_, index) => limit(async () => {
    started.push(index);
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return index;
  }));

  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
});

test('async limiter releases a slot after a rejected task', async () => {
  const limit = createAsyncLimiter(1);
  const calls: string[] = [];
  const failed = limit(async () => {
    calls.push('failed');
    throw new Error('boom');
  });
  const recovered = limit(async () => {
    calls.push('recovered');
    return 42;
  });

  await assert.rejects(failed, /boom/);
  assert.equal(await recovered, 42);
  assert.deepEqual(calls, ['failed', 'recovered']);
});
