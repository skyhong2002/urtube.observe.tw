import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { historyPage } from '../src/output/history.js';
import type { YoutubeHistoryEntry } from '../src/youtube/history.js';

function render(entries: YoutubeHistoryEntry[], lang: 'zh' | 'en' = 'en') {
  return load(historyPage({ ownerName: 'Demo', profilePath: '/demo', profileHtml: '', viewerOwns: false, nav: [], lang,
    result: { entries, filters: { range: 'all', q: 'music', from: '2026-09-01', to: '2026-09-19' }, olderCursor: 'older', newerCursor: 'newer' },
  }));
}

function entry(changes: Partial<YoutubeHistoryEntry> = {}): YoutubeHistoryEntry {
  return { eventId: 'test', videoId: null, title: 'Example', url: 'https://www.youtube.com/watch?v=example1234',
    channelId: null, channelTitle: 'Channel', thumbnailUrl: '', durationSeconds: null, actualWatchedSeconds: null,
    watchedAt: '2026-09-18T04:00:00.000Z', watchCount: 1, precision: 'day', ...changes };
}

test('date-only watches never present synthetic noon as an exact watch time', () => {
  for (const lang of ['zh', 'en'] as const) {
    const $ = render([entry(), entry({ eventId: 'exact', precision: 'exact', watchedAt: '2026-09-18T16:01:00.000Z' })], lang);
    const times = $('.hs-when');
    assert.equal(times.eq(0).attr('datetime'), '2026-09-18');
    assert.equal(times.eq(0).text(), lang === 'zh' ? '僅有日期' : 'Date only');
    assert.equal(times.eq(1).text(), '00:01');
    assert.equal($('.hs-day h3 time').eq(1).attr('datetime'), '2026-09-19');
  }
});

test('untrusted archive links cannot create executable or credential-bearing links', () => {
  const $ = render([entry({ url: 'javascript:alert(1)', thumbnailUrl: 'data:text/html,<script>alert(1)</script>', title: '<img src=x onerror=alert(1)>' }),
    entry({ eventId: 'credentials', url: 'https://user:pass@example.com/' })]);
  assert.equal($('.hs-row a, a.hs-row, .hs-thumb[src]').length, 0);
  assert.equal($('.hs-copy strong').first().text(), '<img src=x onerror=alert(1)>');
  assert.equal($('.hs-copy img').length, 0);
});

test('changing filters resets pagination while page links preserve the complete search', () => {
  const $ = render([]);
  const form = $('form[role=search]');
  assert.equal(form.attr('method'), 'get');
  assert.equal(form.find('[name=cursor], [name=direction]').length, 0);
  for (const a of $('.hs-pages a').toArray()) {
    const url = new URL($(a).attr('href')!, 'https://example.com');
    assert.equal(url.searchParams.get('q'), 'music');
    assert.equal(url.searchParams.get('from'), '2026-09-01');
    assert.equal(url.searchParams.get('to'), '2026-09-19');
    assert.equal(url.searchParams.get('lang'), 'en');
  }
  for (const a of $('.yt-range a').toArray()) {
    const params = new URL($(a).attr('href')!, 'https://example.com').searchParams;
    assert.equal(params.get('q'), 'music');
    for (const field of ['cursor', 'direction', 'from', 'to']) assert.equal(params.has(field), false);
  }
  assert.equal($('.yt-range [aria-current]').length, 0, 'custom dates must not label an unrelated preset as selected');
  assert.equal(form.find('[name=q]').attr('value'), 'music', 'empty results remain searchable');
});
