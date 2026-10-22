import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { TagListSnapshot } from '../src/youtube/taglists.js';

const host = '127.0.0.1';
const requestedPort = Number.parseInt(process.env.DEMO_PORT ?? '4317', 10);
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65_535) {
  throw new Error('DEMO_PORT must be an integer from 1024 to 65535');
}
// Same-origin checks on POST APIs compare against the configured public URL,
// which is read when the app modules load, so set it before importing them.
process.env.PUBLIC_BASE_URL = `http://${host}:${requestedPort}`;
const { createApp } = await import('../src/index.js');
const { UserRegistry } = await import('../src/users.js');
const { seedMatchingDemo } = await import('./matching-demo-seed.js');

const root = mkdtempSync(join(tmpdir(), 'urtube-matching-demo-'));
const registry = new UserRegistry(join(root, 'users.sqlite'), join(root, 'users'));

const { alice, bob, carol, newcomer, matchingV3 } = await seedMatchingDemo(registry);
assert.equal(registry.matchingCrystalFor(newcomer.handle), null, 'newcomer must not receive an invented matching signal');

const sessions = new Map([
  [randomBytes(24).toString('base64url'), registry.createSession(alice)],
  [randomBytes(24).toString('base64url'), registry.createSession(bob)],
  [randomBytes(24).toString('base64url'), registry.createSession(carol)],
  [randomBytes(24).toString('base64url'), registry.createSession(newcomer)],
]);
const [aliceAccess, bobAccess, carolAccess, newcomerAccess] = sessions.keys();

const noTaggedChannels = async (): Promise<TagListSnapshot> => ({
  lists: {
    news: new Set(), editorial: new Set(), editorialShows: new Set(),
    blue: new Set(), green: new Set(), white: new Set(), red: new Set(),
  },
  provenance: {
    sourceUrl: 'synthetic-local-demo',
    sourceUpdatedAt: '2026-09-05 00:00:00',
    fetchedAt: new Date().toISOString(),
    membershipVersion: 'synthetic-local-demo',
    policyVersion: 'synthetic-local-demo',
    policyUrl: '/docs/channel-tag-policy.md',
    reportUrl: 'https://github.com/skyhong2002/urtube.observe.tw/issues',
  },
});

const demo = new Hono();
demo.get('/__demo/session/:access', (c) => {
  const session = sessions.get(c.req.param('access'));
  if (!session) return c.notFound();
  setCookie(c, 'urtube_session', session, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
  });
  return c.redirect('/matches');
});
demo.route('/', createApp(registry, { loadTagLists: noTaggedChannels, matchingV3 }));

const server = serve({ fetch: demo.fetch, hostname: host, port: requestedPort }, (info) => {
  const base = `http://${host}:${info.port}`;
  console.log('Synthetic matching demo ready. Open each URL in a separate browser profile:');
  console.log(`Alice: ${base}/__demo/session/${aliceAccess}`);
  console.log(`Bob:   ${base}/__demo/session/${bobAccess}`);
  console.log(`Carol (incomplete history, provisional topics): ${base}/__demo/session/${carolAccess}`);
  console.log(`New member (no history): ${base}/__demo/session/${newcomerAccess}`);
  console.log(`Topic matching (v3, synthetic profiles, no API keys): ${base}/matches?view=topics`);
  console.log('Restart this command to reset every request and connection. Press Ctrl-C to stop.');
});

function close(): void {
  server.close(() => {
    registry.close();
    rmSync(root, { recursive: true, force: true });
    process.exit(0);
  });
}

process.once('SIGINT', close);
process.once('SIGTERM', close);
