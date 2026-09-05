import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationError } from '../src/output/presentation-errors.js';

test('browser errors never expose unexpected provider or storage details', () => {
  const sensitive = new Error('provider response: credential=private-value; database=/srv/private/users.sqlite');
  for (const context of ['login', 'signup', 'takeout', 'settings', 'delete'] as const) {
    const zh = presentationError(sensitive, 'zh', context);
    const en = presentationError(sensitive, 'en', context);
    assert.doesNotMatch(zh + en, /private-value|users\.sqlite|provider response/);
    assert.match(zh, /[\u4e00-\u9fff]/);
    assert.doesNotMatch(en, /[\u4e00-\u9fff]/);
    assert.notEqual(zh, en);
  }
});

test('recognized input errors retain actionable recovery guidance', () => {
  assert.match(presentationError(new Error('Handle must be 2-32 chars of lowercase letters, digits, dots, or dashes'), 'zh', 'signup'), /2–32.*點.*字母或數字開頭/);
  assert.match(presentationError(new Error('Archive contains no recognized YouTube watch or search history'), 'en', 'takeout'), /Check the data selected for export/);
  assert.match(presentationError(new Error('YouTube archive exceeds uncompressed size limit'), 'en', 'takeout'), /Export only YouTube history/);
  assert.match(presentationError(null, 'en', 'delete'), /deletion request/);
});
