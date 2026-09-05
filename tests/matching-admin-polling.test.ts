import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/matching-v3/admin.js', import.meta.url), 'utf8');
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function pollingHarness(hidden = false) {
  const listeners = new Map<string, () => unknown>();
  const timers = new Map<number, { callback: () => unknown; delay: number }>();
  const requests: { resolve: (response: unknown) => void; signal: AbortSignal }[] = [];
  const elements = new Map<string, { textContent: string; addEventListener: (event: string, callback: () => unknown) => void }>();
  let timerId = 0;
  const document = {
    hidden,
    getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, { textContent: '', addEventListener: (event, callback) => listeners.set(`${id}:${event}`, callback) });
      return elements.get(id);
    },
    addEventListener: (event: string, callback: () => unknown) => listeners.set(event, callback),
  };
  const context = createContext({
    document, AbortSignal,
    fetch: (_url: string, options: { signal: AbortSignal }) => new Promise(resolve => requests.push({ resolve, signal: options.signal })),
    setTimeout: (callback: () => unknown, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  runInContext(source, context);
  // Polling is exercised with controlled responses; DOM rendering has separate coverage.
  runInContext('render = () => {};', context);
  return {
    requests, timers,
    refresh: () => listeners.get('refresh:click')!(),
    visibility(value: boolean) { document.hidden = value; listeners.get('visibilitychange')!(); },
    respond(status = 200, snapshot: { now: number; sampledAt?: number } = { now: 1 }) {
      requests.at(-1)!.resolve({ ok: status === 200, status, json: async () => snapshot }); return settle();
    },
    connectionText: () => elements.get('connection')!.textContent,
    tick() {
      assert.equal(timers.size, 1);
      const [id, timer] = [...timers][0]; timers.delete(id); timer.callback();
    },
    delay() { assert.equal(timers.size, 1); return [...timers.values()][0].delay; },
  };
}

test('admin polling waits until visible and pauses its scheduled refresh while hidden', async () => {
  const page = pollingHarness(true);
  assert.equal(page.requests.length, 0);
  assert.equal(page.timers.size, 0);
  page.visibility(false);
  assert.equal(page.requests.length, 1);
  await page.respond();
  assert.equal(page.delay(), 30000);
  page.visibility(true);
  assert.equal(page.timers.size, 0);
  page.refresh();
  assert.equal(page.requests.length, 1);
  page.visibility(false);
  assert.equal(page.requests.length, 2);
  await page.respond();
  assert.equal(page.delay(), 30000);
});

test('admin polling never overlaps requests and only schedules after completion while visible', async () => {
  const page = pollingHarness();
  assert.equal(page.requests.length, 1);
  assert.ok(page.requests[0].signal instanceof AbortSignal);
  page.refresh(); page.visibility(true); page.visibility(false); page.refresh();
  assert.equal(page.requests.length, 1);
  assert.equal(page.timers.size, 0);
  page.visibility(true);
  await page.respond();
  assert.equal(page.timers.size, 0);
  page.visibility(false);
  assert.equal(page.requests.length, 2);
  await page.respond();
  page.tick();
  assert.equal(page.requests.length, 3);
  assert.equal(page.timers.size, 0);
  await page.respond();
  assert.equal(page.delay(), 30000);
});

test('admin polling backs off failed requests to two minutes and resets after recovery', async () => {
  const page = pollingHarness();
  for (const expected of [60000, 120000, 120000]) {
    await page.respond(503);
    assert.equal(page.delay(), expected);
    page.tick();
  }
  await page.respond();
  assert.equal(page.delay(), 30000);
  page.refresh();
  assert.equal(page.timers.size, 0);
  await page.respond(502);
  assert.equal(page.delay(), 60000);
});

test('admin polling shows snapshot sample time rather than cached response time, with legacy fallback', async () => {
  const page = pollingHarness();
  const sampledAt = Date.UTC(2026, 8, 6, 1), now = sampledAt + 20000;
  const formatted = (value: number) => new Date(value).toLocaleString('zh-TW', { hour12: false });
  await page.respond(200, { now, sampledAt });
  assert.equal(page.connectionText(), `已連線 · 資料更新於 ${formatted(sampledAt)}`);
  page.tick();
  await page.respond(200, { now });
  assert.equal(page.connectionText(), `已連線 · 資料更新於 ${formatted(now)}`);
});
