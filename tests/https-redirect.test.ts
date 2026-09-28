import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { forceHttps } from '../src/https-redirect.js';
import { config } from '../src/config.js';
import { createApp } from '../src/index.js';
import { createIngestApp } from '../src/ingest.js';
import { UserRegistry } from '../src/users.js';

test('HTTPS redirect preserves paths and query strings and never redirects to a supplied host', async () => {
  const app = new Hono(); let reached = 0;
  app.use('*', forceHttps('https://urtube.observe.tw'));
  app.all('*', c => { reached++; return c.text('origin'); });
  for (const path of ['/', '/matches?view=topics&lang=zh', '/%E6%B8%AC%E8%A9%A6?a=%2F&b=two+words', '//evil.example/path?q=1']) {
    const response = await app.request(`http://urtube.observe.tw${path}`, {
      headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'evil.example' },
    });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), `https://urtube.observe.tw${path}`);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal(reached, 0, 'redirect runs before routes');
});

test('HTTPS tunnel traffic, local health checks, and HTTP development avoid redirect loops', async () => {
  const app = new Hono();
  app.use('*', forceHttps('https://urtube.observe.tw'));
  app.all('*', c => c.text('ok'));
  for (const [url, headers] of [
    ['http://urtube.observe.tw/readyz', { 'x-forwarded-proto': 'https' }],
    ['https://urtube.observe.tw/', {}],
    ['http://127.0.0.1:3000/healthz', {}],
    ['http://localhost:3001/healthz', {}],
  ] as Array<[string, Record<string, string>]>) {
    const response = await app.request(url, { headers });
    assert.equal(response.status, 200); assert.equal(response.headers.get('location'), null);
  }
  const dev = new Hono(); dev.use('*', forceHttps('http://localhost:3000'));
  dev.get('/', c => c.text('dev'));
  assert.equal((await dev.request('http://localhost:3000/')).status, 200);
});

test('website and ingestion both redirect before authentication or writes', async () => {
  const original = config.publicBaseUrl;
  const registry = new UserRegistry(':memory:');
  try {
    config.publicBaseUrl = 'https://urtube.observe.tw';
    for (const [app, path] of [
      [createApp(registry), '/signup'],
      [createIngestApp(registry), '/api/ingest/youtube/capture'],
    ] as const) {
      const response = await app.request(`http://urtube.observe.tw${path}?trial=1`, {
        method: 'POST', headers: { 'x-forwarded-proto': 'http' }, body: 'synthetic-upload',
      });
      assert.equal(response.status, 308, 'permanent redirect retains POST method and body');
      assert.equal(response.headers.get('location'), `https://urtube.observe.tw${path}?trial=1`);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
    assert.equal(registry.listUsers().length, 0);
  } finally { config.publicBaseUrl = original; registry.close(); }
});
