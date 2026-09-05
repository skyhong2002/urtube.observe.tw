import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { processingVisibilityScript, processingVisibilityStyles } from '../src/output/processing-visibility.js';
import { primaryNav, shell } from '../src/output/pages.js';
import { accountPage } from '../src/output/onboarding.js';
import { UserRegistry } from '../src/users.js';

function fixture(account: string, storage = new Map<string, string>(), blocked = false) {
  const input = { checked: true, matches: () => true };
  const status = { textContent: '', dataset: { lang: 'zh' } };
  const documentEvents: Record<string, (event?: unknown) => void> = {};
  const windowEvents: Record<string, (event?: unknown) => void> = {};
  const root = { dataset: { processingAccount: account, processingVisibility: '' } };
  const emitted: string[] = [];
  runInNewContext(processingVisibilityScript, {
    Event,
    document: { documentElement: root,
      querySelectorAll: (selector: string) => selector === '[data-processing-visibility-toggle]' ? [input] : [status],
      addEventListener: (name: string, fn: (event?: unknown) => void) => { documentEvents[name] = fn; } },
    window: { dispatchEvent: (event: Event) => emitted.push(event.type),
      addEventListener: (name: string, fn: (event?: unknown) => void) => { windowEvents[name] = fn; } },
    localStorage: { getItem: (key: string) => { if (blocked) throw Error('blocked'); return storage.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (blocked) throw Error('blocked'); storage.set(key, value); } },
  });
  return { root, input, status, storage, emitted, windowEvents, documentEvents,
    toggle(shown: boolean) { input.checked = shown; documentEvents.change({ target: input }); } };
}

test('processing display defaults on, persists per account across pages and can be restored', () => {
  const f = fixture('/alice');
  assert.equal(f.input.checked, true);
  assert.equal(f.root.dataset.processingVisibility, 'shown');
  f.toggle(false);
  assert.equal(f.status.textContent, '已隱藏處理進度');
  const next = fixture('/alice', f.storage);
  assert.equal(next.root.dataset.processingVisibility, 'hidden');
  assert.equal(next.input.checked, false);
  next.windowEvents['urtube:page-updated']();
  assert.equal(next.root.dataset.processingVisibility, 'hidden');
  assert.equal(fixture('/bob', f.storage).input.checked, true, 'another account keeps its own default');
  assert.equal(fixture('', f.storage).input.checked, true, 'signed-out pages do not inherit an account preference');
  next.toggle(true);
  assert.equal(fixture('/alice', f.storage).root.dataset.processingVisibility, 'shown');
});

test('cross-tab updates apply immediately and unavailable storage leaves the current switch usable', () => {
  const f = fixture('/alice');
  f.storage.set('urtube:show-processing:/alice', 'false');
  f.windowEvents.storage({ key: 'urtube:show-processing:/alice' });
  assert.equal(f.input.checked, false);
  f.storage.clear(); f.windowEvents.storage({ key: null });
  assert.equal(f.input.checked, true);
  const unavailable = fixture('/alice', new Map(), true);
  unavailable.toggle(false);
  assert.equal(unavailable.root.dataset.processingVisibility, 'hidden');
  assert.match(unavailable.status.textContent, /瀏覽器無法儲存/);
});

test('settings keeps the default-on control outside processing blocks and shell applies account preference before content', () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('display-fixture', 'Display fixture');
    const markup = accountPage(user, {}, 'zh');
    const $ = load(markup);
    const control = $('[data-processing-visibility-toggle]');
    assert.equal(control.prop('checked'), true);
    assert.equal(control.attr('role'), 'switch');
    assert.equal(control.closest('#processing,[data-processing-status],.yt-v3-processing').length, 0);
    assert.equal($('html').attr('data-processing-account'), '/display-fixture');
    assert.match($('.processing-display-setting').text(), /在頁面上顯示資料整理進度/);
    assert.ok(markup.indexOf('urtube:show-processing:') < markup.indexOf('<body>'));
    assert.match(processingVisibilityStyles, /yt-v3-processing.*yt-processing.*yt-provisional.*mt-provisional/);
    const otherProfile = load(shell('Other profile', '', primaryNav('en', { dashboardHref: '/viewer' })));
    assert.equal(otherProfile('html').attr('data-processing-account'), '/viewer', 'preference belongs to viewer, not viewed profile');
  } finally { registry.close(); }
});
