import assert from 'node:assert/strict';
import test from 'node:test';
import { GeminiKeyPool } from '../src/matching-v3/gemini-keys.js';
import { settings, version } from '../src/matching-v3/model.js';

test('Gemini key configuration deduplicates and preserves profile version', () => {
  const single = settings({ GEMINI_API_KEY: 'old' });
  const many = settings({ GEMINI_API_KEY: 'old', GEMINI_API_KEYS: 'a,b, a\n c' });
  assert.deepEqual(single.embeddingApiKeys, ['old']);
  assert.deepEqual(many.embeddingApiKeys, ['a', 'b', 'c']);
  assert.equal(version(single), version(many));
});
test('Gemini rotates concurrent requests evenly', async () => {
  const pool = new GeminiKeyPool(['a','b','c']), seen: string[] = [];
  await Promise.all(Array.from({ length: 9 }, () => pool.request(async key => { seen.push(key); return new Response('{}'); })));
  assert.deepEqual(seen, ['a','b','c','a','b','c','a','b','c']);
});
test('Gemini skips cooled keys, honors RetryInfo, and resumes after cooldown', async () => {
  let now = 0;
  const pool = new GeminiKeyPool(['a','b'], () => now), seen: string[] = [];
  const send = async (key: string) => { seen.push(key); return key === 'a' && now === 0
    ? new Response(JSON.stringify({ error: { details: [{ retryDelay: '120s' }] } }), { status: 429 }) : new Response('{}'); };
  assert.equal((await pool.request(send))?.status, 200);
  await pool.request(send);
  assert.deepEqual(seen, ['a','b','b']);
  now = 120001;
  await pool.request(send);
  assert.equal(seen.at(-1), 'a');
});
test('Gemini all limited keys return without a retry storm; auth failures disable a key', async () => {
  const pool = new GeminiKeyPool(['a','b']); let calls = 0;
  const limited = async () => { calls++; return new Response('{}', { status: 429, headers: { 'Retry-After': '90' } }); };
  assert.equal(await pool.request(limited), null);
  assert.equal(await pool.request(limited), null);
  assert.equal(calls, 2);
  const invalid = new GeminiKeyPool(['bad']);
  await invalid.request(async () => new Response('{}', { status: 403 }));
  assert.equal(invalid.allDisabled, true);
  await invalid.request(async () => { throw new Error('disabled key reused'); });
});
