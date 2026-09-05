import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createYoutubeApiKeyPool, nextYoutubeQuotaReset, parseYoutubeApiKeys } from '../src/youtube/api-keys.js';
import { fetchYoutubeMetadata, youtubeApiUsage } from '../src/youtube/metadata.js';

const quotaBody = JSON.stringify({ error: { code: 403, errors: [{ domain: 'youtube.quota', reason: 'quotaExceeded' }] } });
const okBody = (id: string) => JSON.stringify({ items: [{ id, snippet: { title: id } }] });

test('YouTube quota reset is midnight Pacific time in both DST and standard time', () => {
  assert.equal(new Date(nextYoutubeQuotaReset(Date.parse('2026-09-06T12:00:00Z'))).toISOString(), '2026-09-07T07:00:00.000Z');
  assert.equal(new Date(nextYoutubeQuotaReset(Date.parse('2026-09-06T07:30:00Z'))).toISOString(), '2026-09-07T07:00:00.000Z');
  assert.equal(new Date(nextYoutubeQuotaReset(Date.parse('2026-01-15T12:00:00Z'))).toISOString(), '2026-01-16T08:00:00.000Z');
});

test('YouTube API key parsing trims, drops blanks, and dedupes while keeping order', () => {
  assert.deepEqual(parseYoutubeApiKeys('one', ' two ,, three,one', undefined, ''), ['one', 'two', 'three']);
});

test('YouTube API key pool prefers the first key and parks exhausted keys until the reset', () => {
  let now = Date.parse('2026-09-06T12:00:00Z');
  const pool = createYoutubeApiKeyPool(['first', 'second'], () => now);
  assert.equal(pool.size, 2);
  assert.equal(pool.next(), 'first');
  pool.exhausted('first');
  assert.equal(pool.next(), 'second');
  pool.exhausted('second');
  assert.equal(pool.next(), null);
  now = Date.parse('2026-09-07T06:59:59Z');
  assert.equal(pool.next(), null);
  now = Date.parse('2026-09-07T07:00:00Z');
  assert.equal(pool.next(), 'first');
});

test('YouTube metadata fetch rotates keys on quotaExceeded and remembers the parked key', async () => {
  const seenKeys: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const key = url.searchParams.get('key')!;
    seenKeys.push(key);
    if (key === 'first') return new Response(quotaBody, { status: 403 });
    return new Response(okBody(url.searchParams.get('id')!), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const pool = createYoutubeApiKeyPool(['first', 'second']);
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message: string) => { warnings.push(message); };
  try {
    const [video] = await fetchYoutubeMetadata(['video-1'], pool, fetchImpl);
    assert.equal(video.title, 'video-1');
    assert.deepEqual(seenKeys, ['first', 'second']);
    assert.match(warnings[0], /key …irst hit its daily quota; switching to key …cond/);

    // The parked key is skipped on the next call without another 403.
    await fetchYoutubeMetadata(['video-2'], pool, fetchImpl);
    assert.deepEqual(seenKeys, ['first', 'second', 'second']);
  } finally {
    console.warn = originalWarn;
  }
});

test('YouTube metadata fetch surfaces the quota error once every key is exhausted', async () => {
  const fetchImpl = (async () => new Response(quotaBody, { status: 403 })) as typeof fetch;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(
      fetchYoutubeMetadata(['video-1'], ['first', 'second'], fetchImpl),
      /YouTube Data API: HTTP 403: .*quotaExceeded/,
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('YouTube metadata fetch does not rotate keys for non-quota 403s', async () => {
  const seenKeys: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    seenKeys.push(new URL(String(input)).searchParams.get('key')!);
    return new Response('API key not valid', { status: 403 });
  }) as typeof fetch;
  await assert.rejects(
    fetchYoutubeMetadata(['video-1'], ['first', 'second'], fetchImpl),
    /YouTube Data API: HTTP 403: API key not valid/,
  );
  assert.deepEqual(seenKeys, ['first']);
});

test('YouTube API usage counts one unit per request attempt', async () => {
  const before = youtubeApiUsage().requestsSinceReset;
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.searchParams.get('key') === 'first') return new Response(quotaBody, { status: 403 });
    return new Response(okBody(url.searchParams.get('id')!), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await fetchYoutubeMetadata(['video-1'], ['first', 'second'], fetchImpl);
  } finally {
    console.warn = originalWarn;
  }
  const usage = youtubeApiUsage();
  assert.equal(usage.requestsSinceReset - before, 2);
  assert.ok(Date.parse(usage.quotaResetAt) > Date.now());
});
