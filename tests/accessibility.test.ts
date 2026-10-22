import assert from 'node:assert/strict';
import test from 'node:test';
import { matchingWorkspace } from '../src/matching-v3/page.js';

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
