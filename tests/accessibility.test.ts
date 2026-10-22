import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { load } from 'cheerio';
import { matchingWorkspace } from '../src/matching-v3/page.js';
import { accountPage, signupCompletePage, signupStartPage } from '../src/output/onboarding.js';
import { shell } from '../src/output/pages.js';
import { UserRegistry } from '../src/users.js';

test('every dialog in the matching workspace has an accessible name', () => {
  for (const lang of ['en', 'zh'] as const) {
    const markup = matchingWorkspace('', '', false, lang);
    const dialogs = markup.match(/<dialog\b[^>]*>/g) ?? [];
    assert.ok(dialogs.length > 0);
    for (const dialog of dialogs) {
      const labelledBy = dialog.match(/aria-labelledby="([^"]+)"/)?.[1];
      assert.ok(labelledBy || /aria-label="/.test(dialog), `${dialog} needs a name`);
      if (labelledBy) assert.match(markup, new RegExp(`id="${labelledBy}"`), `${labelledBy} exists`);
    }
  }
});

test('the shell offers a localized keyboard skip link and respects reduced motion', () => {
  for (const lang of ['en', 'zh'] as const) {
    const markup = shell('Fixture', '<h1>Fixture</h1>', [], '', lang);
    const page = load(markup);
    const firstLink = page('body a').first();
    assert.equal(firstLink.attr('href'), '#main-content');
    assert.equal(firstLink.text(), lang === 'zh' ? '跳到主要內容' : 'Skip to main content');
    assert.equal(page('main#main-content').attr('tabindex'), '-1');
    assert.match(markup, /prefers-reduced-motion:reduce\)\{html\{scroll-behavior:auto\}/);
    for (const control of ['select', 'textarea', 'summary']) assert.ok(markup.includes(`${control}:focus-visible`));
  }
});

test('signup exposes status and errors, masks the claim key, and escapes rejected values', () => {
  const attack = '\"><img src=x onerror=alert(1)></script><script>alert(1)</script>';
  for (const lang of ['en', 'zh'] as const) {
    const markup = signupCompletePage({ email: `${attack}@example.invalid`, suggestedHandle: attack }, attack, lang);
    const page = load(markup);
    assert.equal(page('#handle').attr('value'), attack);
    assert.equal(page('#signup-error').text(), attack);
    assert.equal(page('#signup-error').attr('role'), 'alert');
    assert.equal(page('#signup-error').attr('tabindex'), '-1');
    assert.equal(page('#handle').attr('aria-describedby'), 'handle-hint');
    assert.equal(page('#handle-hint').attr('role'), 'status');
    assert.equal(page('#claimKey').attr('type'), 'password');
    assert.equal(page('#handle').attr('autocapitalize'), 'none');
    assert.equal(page('[onerror]').length, 0);
    assert.doesNotMatch(markup, /<script>alert\(1\)<\/script>/);
    const pattern = new RegExp(`^(?:${page('#handle').attr('pattern')})$`, 'v');
    for (const handle of ['al-ex', 'a.b', 'a1']) assert.ok(pattern.test(handle));
    for (const handle of ['-alice', 'ALICE', 'a', 'a/b']) assert.equal(pattern.test(handle), false);
    assert.equal(load(signupStartPage(attack, lang))('[role=alert]').text(), attack);
  }
});

test('account feedback receives focus after page show and Takeout status is outside the busy form', () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('focus-fixture', 'Fixture');
    for (const state of [{ updated: 'visibility' as const }, { takeoutError: 'Fixture error' }, { error: 'Fixture error' }]) {
      const markup = accountPage(user, state);
      const page = load(markup);
      assert.equal(page('#takeout-status').closest('form').length, 0);
      assert.equal(page('#takeout').attr('aria-describedby'), 'takeout-limit takeout-status');
      const feedback = page('#account-error, #account-takeout .ob-error, #settings-feedback');
      assert.equal(feedback.length, 1);
      assert.equal(feedback.parents('details:not([open])').length, 0, 'feedback is visible without JavaScript');
      const script = page('script').toArray().map(node => page(node).html() ?? '').find(source => source.includes('const revealTarget'))!;
      let focused = false;
      const target = { tabIndex: 0, focus() { focused = true; } };
      const listeners = new Map<string, () => void>();
      vm.runInNewContext(script, {
        document: { readyState: 'loading', getElementById: () => null,
          querySelector: (selector: string) => selector.includes('#account-error') ? target : null },
        location: { hash: '' },
        addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      });
      assert.equal(focused, false);
      listeners.get('pageshow')!();
      assert.equal(focused, true);
      assert.equal(target.tabIndex, -1);
    }
  } finally { registry.close(); }
});
