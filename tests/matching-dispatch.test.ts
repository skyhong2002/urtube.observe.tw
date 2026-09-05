import test from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchLimiter } from '../src/matching-v3/dispatch.js';

test('uncapped Gemini dispatcher starts all work without waiting for earlier responses', async () => {
  const limit = createDispatchLimiter(Infinity);
  let active = 0, release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const tasks = Array.from({ length: 150 }, () => limit(async () => { active++; await gate; }));
  try {
    for (let turn=0;turn<10 && active<150;turn++) await new Promise<void>(r => setImmediate(r));
    assert.equal(active, 150);
  } finally { release(); await Promise.all(tasks); }
});
