import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { load } from 'cheerio';
import { sharingPreview, sharingPreviewScript } from '../src/output/sharing-preview.js';

test('sharing preview updates all audiences locally, without publishing or exposing raw history', () => {
  for (const lang of ['en', 'zh'] as const) {
    const markup = sharingPreview({ displayName: '<script>private</script>', handle: 'fixture', matchingOptIn: false, dashboardPublic: false }, lang);
    const $ = load(markup);
    assert.equal($('script').length, 0, 'identity is escaped');
    assert.equal($('[data-sharing-variant]:not([hidden])').attr('data-sharing-variant'), '00');
    const matching = { checked: false }, publicPage = { checked: false };
    const panels = $('[data-sharing-variant]').toArray().map(el => ({
      dataset: { sharingVariant: $(el).attr('data-sharing-variant') }, hidden: $(el).attr('hidden') !== undefined,
    }));
    let change: () => void = () => {}, pageshow: () => void = () => {};
    const form = { elements: { namedItem: (name: string) => name === 'matchingOptIn' ? matching : publicPage },
      addEventListener: (name: string, callback: () => void) => { assert.equal(name, 'change'); change = callback; } };
    const preview = { closest: () => form, querySelectorAll: () => panels };
    runInNewContext(sharingPreviewScript.replace(/^<script>|<\/script>$/g, ''), {
      document: { querySelector: () => preview },
      window: { addEventListener: (_name: string, callback: () => void) => { pageshow = callback; } },
      // No fetch, location, or form submit capability: preview must be local.
    });
    for (const m of [true, false]) for (const p of [true, false]) {
      matching.checked = m; publicPage.checked = p; change();
      const visible = panels.filter(panel => !panel.hidden);
      const key = `${Number(m)}${Number(p)}`;
      assert.equal(visible.length, 1); assert.equal(visible[0].dataset.sharingVariant, key);
      const rows = $(`[data-sharing-variant="${key}"] dd`).map((_i, el) => $(el).text()).toArray();
      const profile = lang === 'zh' ? /總覽與洞察/ : /Overview and Insights/;
      assert.equal(profile.test(rows[0]), p, 'signed-out visitors require a public profile');
      assert.equal(profile.test(rows[1]), p, 'discovery alone does not reveal the full profile');
      assert.equal(profile.test(rows[2]), p || m, 'mutual friendship allows profile access');
      if (m && !p) assert.match(rows[1], lang === 'zh' ? /頻道頁.*排行/ : /Channel pages.*rankings/);
    }
    matching.checked = true; pageshow();
    assert.equal(panels.find(panel => !panel.hidden)?.dataset.sharingVariant, '10', 'restored form state refreshes the preview');
    assert.match(markup, lang === 'zh' ? /持有私人存取金鑰/ : /private access key/);
    assert.match(markup, lang === 'zh' ? /儲存在 urtube 伺服器/ : /stored on urtube servers/);
  }
});
