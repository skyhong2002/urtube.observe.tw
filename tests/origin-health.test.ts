import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { EVENT_LOOP_DELAY_WINDOW_MS, EventLoopLagProbe, nextEventLoopDelay } from '../src/ops-status.js';
import { ORIGIN_KEEP_ALIVE_TIMEOUT_MS, outliveProxyKeepAlive } from '../src/origin-server.js';
import { UserRegistry } from '../src/users.js';

test('origin keeps idle connections longer than the tunnel reuses them', () => {
  const server = outliveProxyKeepAlive(createServer()) as ReturnType<typeof createServer>;
  assert.ok(server.keepAliveTimeout > 90_000, 'outlives cloudflared default idle pool');
  assert.equal(server.keepAliveTimeout, ORIGIN_KEEP_ALIVE_TIMEOUT_MS);
  assert.ok(server.headersTimeout > server.keepAliveTimeout);
});

test('healthz answers from a schema probe without exposing archive counts', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const response = await createApp(registry).request('/healthz');
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.status, 'healthy');
    assert.equal('counts' in body, false);
  } finally {
    registry.close();
  }
});

test('event-loop delay keeps the worst recent stall until its window expires', () => {
  let worst = nextEventLoopDelay(null, 12, 0);
  worst = nextEventLoopDelay(worst, 150_000, 1_000);
  assert.deepEqual(worst, { ms: 150_000, at: 1_000 });
  worst = nextEventLoopDelay(worst, 20, 31_000);
  assert.deepEqual(worst, { ms: 150_000, at: 1_000 }, 'small follow-up does not erase the stall');
  worst = nextEventLoopDelay(worst, 20, 1_000 + EVENT_LOOP_DELAY_WINDOW_MS + 1);
  assert.equal(worst.ms, 20, 'stale stall ages out');
});

test('lag probe reports a synchronous block, including one still in progress', () => {
  let clock = 0;
  const probe = new EventLoopLagProbe(1_000, () => clock);
  clock = 1_000; probe.tick();
  assert.equal(probe.take(), 0, 'on-time timer');
  clock = 151_000; probe.tick();
  assert.equal(probe.take(), 149_000, 'timer fired 149 s late');
  assert.equal(probe.take(), 0, 'take resets');
  clock = 151_500; probe.tick();
  clock = 272_500;
  assert.equal(probe.take(), 120_000, 'block observed before the next tick');
});

test('lag probe sees a real synchronous block', async () => {
  const probe = new EventLoopLagProbe(20);
  const timer = setInterval(() => probe.tick(), probe.intervalMs);
  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    probe.take();
    const until = Date.now() + 300;
    while (Date.now() < until) { /* block the loop */ }
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.ok(probe.take() >= 250);
  } finally {
    clearInterval(timer);
  }
});
