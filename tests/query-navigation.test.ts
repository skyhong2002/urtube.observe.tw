import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { queryNavigationScript } from '../src/output/query-navigation.js';

test('fragment navigation and history traversal do not fetch or replace the page', () => {
  const listeners = new Map<string, () => void>();
  const location = { href: 'https://example.test/?lang=zh', reload() { assert.fail('unexpected reload'); } };
  let requests = 0;
  const context = {
    window: {}, location, URL, AbortController,
    document: { querySelector: () => null, addEventListener() {} },
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    scrollX: 0, scrollY: 0,
    setTimeout: () => 1, clearTimeout() {},
    fetch: () => { requests++; return new Promise(() => {}); },
  };
  vm.runInNewContext(queryNavigationScript, context);
  for (const hash of ['#community', '#features', '#community', '']) {
    location.href = `https://example.test/?lang=zh${hash}`;
    listeners.get('popstate')!();
    assert.equal(requests, 0, 'native anchor scroll must not trigger a page fetch');
  }
  location.href = 'https://example.test/?lang=zh&range=90d';
  listeners.get('popstate')!();
  assert.equal(requests, 1, 'query history still refreshes the server-rendered page');
});

test('a stalled range request falls back to navigation, while a cancelled request stays cancelled', async () => {
  for (const cancelled of [false, true]) {
    const listeners = new Map<string, () => void>();
    const assigned: string[] = [];
    const location = { href: 'https://example.test/alice?range=30d', assign: (url: string) => assigned.push(url) };
    let timeout: () => void = () => assert.fail('no timeout registered');
    let cleared = false;
    const context = {
      window: {}, location, URL, AbortController,
      document: { querySelector: () => null, addEventListener() {} },
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      scrollX: 0, scrollY: 0,
      setTimeout: (fn: () => void) => { timeout = fn; return 1; },
      clearTimeout: () => { cleared = true; },
      fetch: (_url: string, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    };
    vm.runInNewContext(queryNavigationScript, context);
    location.href = 'https://example.test/alice?range=90d';
    listeners.get('popstate')!();
    if (cancelled) listeners.get('pagehide')!();
    timeout();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(assigned, cancelled ? [] : [location.href]);
    assert.ok(cleared, 'the timeout is cleared when the request settles');
  }
});
