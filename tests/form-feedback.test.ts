import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { unsavedProfileScript, uploadFeedbackScript } from '../src/output/form-feedback.js';

test('profile drafts warn on changed values and ordering, but allow undo and valid submission', () => {
  const events = new Map<string, () => void>();
  const formEvents = new Map<string, () => void>();
  let values = [['displayName', 'Alice'], ['linkUrl', 'https://example.invalid/a'], ['linkUrl', 'https://example.invalid/b']];
  const original = values.map(pair => [...pair]);
  const form = { addEventListener: (type: string, fn: () => void) => formEvents.set(type, fn) };
  const context = {
    document: { querySelector: () => form },
    FormData: class { [Symbol.iterator]() { return values[Symbol.iterator](); } },
    addEventListener: (type: string, fn: () => void) => events.set(type, fn),
  };
  vm.runInNewContext(unsavedProfileScript, context);
  const warns = () => {
    let prevented = false;
    (events.get('beforeunload') as (event: object) => void)({ preventDefault() { prevented = true; } });
    return prevented;
  };
  assert.equal(warns(), false);
  values = [original[0], original[2], original[1]];
  assert.equal(warns(), true, 'reordering social links is an unsaved change');
  values = original;
  assert.equal(warns(), false, 'undoing a change does not prompt');
  values = [['displayName', 'Changed']];
  assert.equal(warns(), true);
  formEvents.get('submit')!();
  assert.equal(warns(), false, 'saving must not trigger a leave warning');
  events.get('pageshow')!();
  assert.equal(warns(), true, 'returning from browser history re-enables draft protection');
});

test('upload feedback prevents duplicate submits and recovers after browser history restoration', () => {
  const events = new Map<string, () => void>();
  const formEvents = new Map<string, (event: { preventDefault(): void }) => void>();
  const inputEvents = new Map<string, () => void>();
  let validity = '';
  const input = {
    files: [{ name: 'history.zip', size: 10 }],
    setCustomValidity: (message: string) => { validity = message; },
    reportValidity() {},
    addEventListener: (type: string, fn: () => void) => inputEvents.set(type, fn),
  };
  const button = { disabled: false, textContent: 'Import' };
  const status = { textContent: '' };
  const form = {
    dataset: { maxBytes: '100', invalidFile: 'Choose ZIP', tooLarge: 'Too large', uploading: 'Importing', wait: 'Keep open' },
    querySelector: (selector: string) => selector === 'input[type=file]' ? input : selector === 'button[type=submit]' ? button : status,
    addEventListener: (type: string, fn: (event: { preventDefault(): void }) => void) => formEvents.set(type, fn),
    setAttribute() {}, removeAttribute() {},
  };
  vm.runInNewContext(uploadFeedbackScript, {
    document: { querySelector: () => form },
    addEventListener: (type: string, fn: () => void) => events.set(type, fn),
  });
  input.files = [{ name: 'history.zip', size: 101 }];
  inputEvents.get('change')!();
  assert.equal(validity, 'Too large');
  input.files = [{ name: 'history.ZIP', size: 100 }];
  inputEvents.get('change')!();
  assert.equal(validity, '');
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
