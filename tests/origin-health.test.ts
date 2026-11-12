import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { EVENT_LOOP_DELAY_WINDOW_MS, EventLoopLagProbe, nextEventLoopDelay } from '../src/ops-status.js';
import { ORIGIN_KEEP_ALIVE_TIMEOUT_MS, outliveProxyKeepAlive } from '../src/origin-server.js';
import { readFileSync } from 'node:fs';
import { config, parseRevision } from '../src/config.js';
import { createIngestApp } from '../src/ingest.js';
import { UserRegistry } from '../src/users.js';
import { runYoutubeWorkerCycle, type YoutubeWorkerSteps } from '../src/youtube-worker.js';

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

test('healthz reports the injected build revision, or "unknown", without changing other fields', async () => {
  // The test environment injects no URTUBE_REVISION.
  assert.equal(config.revision, 'unknown');
  const registry = new UserRegistry(':memory:');
  try {
    const response = await createApp(registry).request('/healthz');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'healthy', service: 'urtube', version: 'unknown' });
    const ingest = await createIngestApp(registry).request('/healthz');
    const body = await ingest.json() as Record<string, unknown>;
    assert.equal(body.service, 'urtube-ingest');
    assert.equal(body.version, 'unknown');
    // A broken database still answers 503 with the same fields.
    const broken = new UserRegistry(':memory:');
    const app = createApp(broken);
    broken.close();
    const failing = await app.request('/healthz');
    assert.equal(failing.status, 503);
    assert.deepEqual(await failing.json(), { status: 'unhealthy', service: 'urtube', version: 'unknown' });
  } finally {
    registry.close();
  }
  const sha = 'a695366' + '0'.repeat(33);
  assert.equal(parseRevision(sha), sha);
  assert.equal(parseRevision(` ${sha.toUpperCase()}\n`), sha);
  assert.equal(parseRevision('a695366'), 'a695366');
  for (const value of [undefined, '', 'unknown', 'main', 'abc', '<script>', sha + '0']) assert.equal(parseRevision(value), 'unknown');
  // The image takes the revision as a build argument and CI passes the commit.
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /^ARG URTUBE_REVISION=unknown$/m);
  assert.match(dockerfile, /^ENV URTUBE_REVISION=\$URTUBE_REVISION$/m);
  const workflow = readFileSync(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /build-args: \|\n\s+URTUBE_REVISION=\$\{\{ github\.sha \}\}/);
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
  assert.equal(probe.take(), 0, 'the same block is not reported twice');
  clock = 273_500; probe.tick();
  assert.equal(probe.take(), 0, 'the next on-time tick after the block is clean');
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

test('a worker cycle with no pending work still lets heartbeat timers run', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    for (let index = 0; index < 5; index++) registry.createUser(`idle-${index}`, `Idle ${index}`);
    let busyUntil = 0;
    const synchronousStep = async () => {
      // Resolves without I/O, like a step whose archive has nothing to do.
      const until = Date.now() + 15;
      while (Date.now() < until) { /* synchronous SQLite stand-in */ }
      return 0;
    };
    const steps: YoutubeWorkerSteps = {
      portability: async () => 'idle',
      metadata: synchronousStep,
      channelMetadata: synchronousStep,
      matchingClassification: synchronousStep,
      classification: synchronousStep,
    };
    let heartbeats = 0;
    const heartbeat = setInterval(() => { heartbeats++; }, 1);
    try {
      busyUntil = heartbeats;
      await runYoutubeWorkerCycle(registry, steps);
    } finally {
      clearInterval(heartbeat);
    }
    // 5 archives x 4 synchronous stages: a timer turn between (almost) each.
    assert.ok(heartbeats - busyUntil >= 15, `heartbeat ran ${heartbeats - busyUntil} times during the cycle`);
  } finally {
    registry.close();
  }
});

test('opening archives for a cycle lets heartbeat timers run between them', async () => {
  const registry = new UserRegistry(':memory:');
  let ticks = 0;
  try {
    for (let index = 0; index < 5; index++) registry.createUser(`cold-${index}`, `Cold ${index}`);
    const opened = new Set<number>();
    const ticksAtOpen: number[] = [];
    const repositoryFor = registry.repositoryFor.bind(registry);
    // A first open runs migrations and a backfill synchronously.
    registry.repositoryFor = (user) => {
      if (!opened.has(user.id)) {
        opened.add(user.id);
        ticksAtOpen.push(ticks);
        const until = Date.now() + 20;
        while (Date.now() < until) { /* cold open stand-in */ }
      }
      return repositoryFor(user);
    };
    const idle = async () => 0;
    const steps: YoutubeWorkerSteps = {
      portability: async () => 'idle', metadata: idle, channelMetadata: idle,
      matchingClassification: idle, classification: idle,
    };
    const heartbeat = setInterval(() => { ticks++; }, 1);
    try {
      await runYoutubeWorkerCycle(registry, steps);
    } finally {
      clearInterval(heartbeat);
    }
    const between = ticksAtOpen.slice(1).filter((value, index) => value > ticksAtOpen[index]).length;
    assert.ok(between >= 3, `a timer ran between ${between} of 4 consecutive archive opens`);
  } finally {
    registry.close();
  }
});
