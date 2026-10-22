import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { load } from 'cheerio';
import { unsavedProfileScript, uploadFeedbackScript } from '../src/output/form-feedback.js';
import { profileEditPage } from '../src/output/profile.js';
import { UserRegistry } from '../src/users.js';

test('profile drafts warn on changed values and ordering, but allow undo and valid submission', () => {
  const events = new Map<string, () => void>();
  const formEvents = new Map<string, () => void>();
  let values = [['displayName', 'Alice'], ['linkUrl', 'https://example.invalid/a'], ['linkUrl', 'https://example.invalid/b']];
  const original = values.map(pair => [...pair]);
  const form = { dataset: { unsaved: 'false' }, addEventListener: (type: string, fn: () => void) => formEvents.set(type, fn) };
  const context = {
    document: { querySelector: () => form },
    FormData: class { [Symbol.iterator]() { return values[Symbol.iterator](); } },
    addEventListener: (type: string, fn: () => void) => events.set(type, fn),
    removeEventListener: (type: string) => events.delete(type),
  };
  vm.runInNewContext(unsavedProfileScript, context);
  const warns = () => {
    let prevented = false;
    (events.get('beforeunload') as ((event: object) => void) | undefined)?.({ preventDefault() { prevented = true; } });
    return prevented;
  };
  assert.equal(events.has('beforeunload'), false, 'a clean page keeps the browser history cache eligible');
  assert.equal(warns(), false);
  values = [original[0], original[2], original[1]];
  formEvents.get('click')!();
  assert.equal(warns(), true, 'reordering social links is an unsaved change');
  values = original;
  formEvents.get('input')!();
  assert.equal(events.has('beforeunload'), false);
  assert.equal(warns(), false, 'undoing a change does not prompt');
  values = [['displayName', 'Changed']];
  formEvents.get('input')!();
  assert.equal(warns(), true);
  (formEvents.get('submit') as (event: object) => void)({ defaultPrevented: true });
  assert.equal(warns(), true, 'a prevented submission still protects the draft');
  (formEvents.get('submit') as (event: object) => void)({ defaultPrevented: false });
  assert.equal(warns(), false, 'saving must not trigger a leave warning');
  events.get('pageshow')!();
  assert.equal(warns(), true, 'returning from browser history re-enables draft protection');
  values = original; form.dataset.unsaved = 'true';
  vm.runInNewContext(unsavedProfileScript, context);
  assert.equal(warns(), true, 'server-rejected drafts are still unsaved on the error page');
});

test('profile editor escapes rejected drafts and validates display names by Unicode characters', () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('profile-feedback', 'Fixture');
    const attack = '\"><img src=x onerror=alert(1)></textarea></script><script>alert(1)</script>';
    const markup = profileEditPage(user, 'fixture-token', 'en', {
      ...user, handle: attack, displayName: attack, bio: attack,
      socialLinks: [{ name: attack, url: attack }],
    }, attack);
    const page = load(markup);
    assert.equal(page('#displayName').val(), attack);
    assert.equal(page('#handle').val(), attack);
    assert.equal(page('#bio').val(), attack);
    assert.equal(page('#profile-error').text(), attack);
    assert.equal(page('[name=linkUrl]').first().val(), attack);
    assert.equal(page('[onerror]').length, 0);
    assert.doesNotMatch(markup, /<script>alert\(1\)<\/script>/);
    assert.equal(page('#profile-form').attr('data-unsaved'), 'true');

    const script = page('script').toArray().map(node => page(node).html() ?? '')
      .find(source => source.includes('const presetButtons'))!.replace(unsavedProfileScript, '');
    const listeners = new Map<string, () => void>();
    let validity = '';
    let errorFocused = false;
    const name = { value: '  ' + '😀'.repeat(80) + '  ',
      setCustomValidity(message: string) { validity = message; },
      addEventListener(type: string, fn: () => void) { listeners.set(type, fn); } };
    const elements: Record<string, object> = {
      '#profile-form': {}, '#add-link': {},
      '#profile-links': { children: [], addEventListener() {} },
      '#bio': { value: '', addEventListener() {}, setCustomValidity() {} },
      '#handle': { value: user.handle, addEventListener() {} },
      '#confirm-change': {}, '#displayName': name,
      '#remaining': {}, '#handle-warning': {}, '#new-url': {},
      '#profile-error': { focus() { errorFocused = true; } },
    };
    vm.runInNewContext(script, { document: {
      querySelector: (selector: string) => elements[selector], querySelectorAll: () => [],
    } });
    assert.equal(validity, '', '80 emoji are 80 Unicode characters');
    assert.ok(errorFocused);
    for (const value of ['😀'.repeat(81), '   ']) {
      name.value = value;
      listeners.get('input')!();
      assert.notEqual(validity, '');
    }
    name.value = 'Corrected';
    listeners.get('input')!();
    assert.equal(validity, '');
  } finally { registry.close(); }
});

test('upload feedback prevents duplicate submits and recovers after browser history restoration', () => {
  const events = new Map<string, () => void>();
  const formEvents = new Map<string, (event: { defaultPrevented?: boolean; preventDefault(): void }) => void>();
  const inputEvents = new Map<string, () => void>();
  let validity = '';
  let reported = false;
  const input = {
    files: [{ name: 'history.zip', size: 10 }],
    setCustomValidity: (message: string) => { validity = message; },
    reportValidity() { reported = true; },
    addEventListener: (type: string, fn: () => void) => inputEvents.set(type, fn),
  };
  const button = { disabled: false, textContent: 'Import' };
  const status = { textContent: '' };
  const form = {
    dataset: { maxBytes: '100', invalidFile: 'Choose ZIP', tooLarge: 'Too large', uploading: 'Importing', wait: 'Keep open' },
    querySelector: (selector: string) => selector === 'input[type=file]' ? input : selector === 'button[type=submit]' ? button : status,
    addEventListener: (type: string, fn: (event: { defaultPrevented?: boolean; preventDefault(): void }) => void) => formEvents.set(type, fn),
    setAttribute() {}, removeAttribute() {},
  };
  vm.runInNewContext(uploadFeedbackScript, {
    document: { querySelector: () => form, getElementById: () => status },
    addEventListener: (type: string, fn: () => void) => events.set(type, fn),
  });
  input.files = [{ name: 'history.html', size: 10 }];
  inputEvents.get('change')!();
  assert.equal(validity, 'Choose ZIP');
  let invalidPrevented = false;
  formEvents.get('submit')!({ preventDefault() { invalidPrevented = true; } });
  assert.ok(invalidPrevented);
  assert.ok(reported);
  assert.equal(button.disabled, false, 'an invalid upload can be corrected and retried');
  input.files = [{ name: 'history.zip', size: 101 }];
  inputEvents.get('change')!();
  assert.equal(validity, 'Too large');
  input.files = [{ name: 'history.ZIP', size: 100 }];
  inputEvents.get('change')!();
  assert.equal(validity, '');
  formEvents.get('submit')!({ defaultPrevented: true, preventDefault() {} });
  assert.equal(button.disabled, false, 'a submission blocked elsewhere does not leave the form busy');
  formEvents.get('submit')!({ preventDefault() { assert.fail('valid upload blocked'); } });
  assert.equal(button.disabled, true);
  assert.equal(status.textContent, 'Keep open');
  let duplicatePrevented = false;
  formEvents.get('submit')!({ preventDefault() { duplicatePrevented = true; } });
  assert.ok(duplicatePrevented);
  events.get('pageshow')!();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Import');
  assert.equal(status.textContent, '');
});
