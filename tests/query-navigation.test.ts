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
