import assert from 'node:assert/strict';
import test from 'node:test';
import { retryYoutubeTimeouts, youtubeRequestJson } from '../src/youtube/request-json.js';
import { createAsyncLimiter } from '../src/youtube/concurrency.js';

const url = new URL('https://example.invalid/videos');

test('YouTube timeout retries release the shared slot and recover with a fresh deadline', async () => {
  const limit = createAsyncLimiter(1);
  const signals: AbortSignal[] = [];
  const delays: number[] = [];
  const fetchImpl = (async (_url, options) => {
    signals.push(options!.signal as AbortSignal);
    if (signals.length < 3) return new Promise<Response>(() => {});
    return Response.json({ items: [] });
  }) as typeof fetch;
  const result = await retryYoutubeTimeouts(
    () => limit(() => youtubeRequestJson(url, fetchImpl, response => response.json(), 15)),
    async ms => {
      delays.push(ms);
      assert.equal(await limit(async () => 'another account'), 'another account');
    },
  );
  assert.deepEqual(result, { items: [] });
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(new Set(signals).size, 3);
  assert.deepEqual(signals.map(signal => signal.aborted), [true, true, false]);
});

test('YouTube persistent timeout fails after exactly two retries', async () => {
  let attempts = 0;
  const failure = new DOMException('YouTube request timed out', 'TimeoutError');
  await assert.rejects(retryYoutubeTimeouts(async () => {
    attempts++;
    throw failure;
  }, async () => {}), error => error === failure);
  assert.equal(attempts, 3);
});

test('YouTube retry preserves ordinary failures without retrying them', async () => {
  for (const failure of [new Error('YouTube: HTTP 403: quotaExceeded'),
    new Error('YouTube: HTTP 401'), new SyntaxError('Invalid JSON')]) {
    let attempts = 0;
    await assert.rejects(retryYoutubeTimeouts(async () => {
      attempts++;
      throw failure;
    }, async () => assert.fail('unexpected retry')), error => error === failure);
    assert.equal(attempts, 1);
  }
});

for (const phase of ['headers', 'body', 'error body']) {
  test(`YouTube timeout releases a slot when ${phase} ignores abort`, async () => {
    const limit = createAsyncLimiter(1);
    let signal: AbortSignal | undefined;
    const never = new Promise<never>(() => {});
    const fetchImpl = (async (_url, options) => {
      signal = options?.signal as AbortSignal;
      if (phase === 'headers') return never;
      return { ok: phase === 'body', json: () => never, text: () => never } as unknown as Response;
    }) as typeof fetch;
    const stalled = limit(() => youtubeRequestJson(url, fetchImpl,
      response => response.ok ? response.json() : response.text(), 15));
    const next = limit(async () => 'next account');
    await assert.rejects(stalled, { name: 'TimeoutError' });
    assert.equal(signal?.aborted, true);
    assert.equal(await next, 'next account');
  });
}

test('YouTube response arriving after its deadline is cancelled without parsing', async () => {
  let respond!: (value: Response) => void;
  let cancelled = false;
  let parsed = false;
  const fetchImpl = (() => new Promise<Response>(resolve => { respond = resolve; })) as typeof fetch;
  const request = youtubeRequestJson(url, fetchImpl, async () => { parsed = true; return {}; }, 15);
  await assert.rejects(request, { name: 'TimeoutError' });
  respond(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.equal(parsed, false);
});

test('YouTube deadline preserves successful bodies and ordinary errors', async () => {
  const good = (async () => Response.json({ items: [] })) as typeof fetch;
  assert.deepEqual(await youtubeRequestJson(url, good, response => response.json()), { items: [] });
  const failure = new Error('network unavailable');
  const bad = (async () => { throw failure; }) as typeof fetch;
  await assert.rejects(youtubeRequestJson(url, bad, response => response.json()), error => error === failure);
});
