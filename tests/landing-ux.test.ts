import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { landingContent } from '../src/output/landing.js';
import { landingChannelShelf } from '../src/output/landing-channels.js';
import { signupStartPage } from '../src/output/onboarding.js';
import { primaryNav, shell } from '../src/output/pages.js';
import type { CommunityStats } from '../src/youtube/community.js';

// Synthetic fixtures only; no real member data.
const channel = (index: number, members: number, watches = 10) => ({
  id: 'UC' + String.fromCharCode(97 + index).repeat(22), name: `Synthetic Channel ${index}`,
  watches, members, estimatedWatchSeconds: watches * 600, thumbnailUrl: '',
});
const stats: CommunityStats = {
  status: 'ready', generatedAt: '2026-11-12T00:00:00.000Z', publicMembers: 3, activeMembers: 3,
  watches: 40, channels: 3, estimatedWatchSeconds: 24000,
  topChannels: [channel(0, 3), channel(1, 1, 1)], topDurationChannels: [channel(0, 3), channel(1, 1, 1)], topWatchedChannels: [channel(0, 3)],
  profiles: [{ handle: 'sample-member', displayName: 'Sample Member' }],
};
const anonymous = (label: string) => `<a class="lp-primary" href="/signup">${label}</a>`;
const signedInAction = '<a class="lp-primary" href="/sample-member">Open my dashboard →</a>';
// Five minutes after the synthetic calculation time: fresh.
const freshNow = Date.parse(stats.generatedAt) + 300_000;

test('the hero leads with the import action and keeps signed-in and closed-signup states', () => {
  const en = load(landingContent('en', anonymous('Sign up / sign in →'), stats));
  const heroPrimary = en('.lp-hero .lp-primary');
  assert.equal(heroPrimary.attr('href'), '/signup');
  assert.match(heroPrimary.text(), /Import my YouTube history/);
  assert.equal(en('.lp-hero .lp-secondary').attr('href'), '#community');
  // Three steps: Google sign-in, an import choice naming both methods, private preview.
  const steps = en('.lp-hero .lp-steps li');
  assert.equal(steps.length, 3);
  assert.match(steps.eq(1).text(), /Chrome extension/);
  assert.match(steps.eq(1).text(), /Google Takeout/);
  assert.match(steps.eq(2).text(), /never publish/);
  assert.match(en('.lp-hero .lp-reassure').text(), /start private/);

  const zh = load(landingContent('zh', anonymous('註冊／登入 →'), stats));
  assert.match(zh('.lp-hero .lp-primary').text(), /開始建立私人回顧/);

  const signedIn = load(landingContent('en', '<a class="lp-primary" href="/sample-member">Open my dashboard →</a>', stats));
  assert.equal(signedIn('.lp-hero .lp-primary').attr('href'), '/sample-member');
  assert.match(signedIn('.lp-hero .lp-primary').text(), /Open my dashboard/);

  const closed = load(landingContent('en', '', stats));
  assert.equal(closed('.lp-hero a.lp-primary').length, 0);
  assert.equal(closed('.lp-hero .lp-disabled').attr('aria-disabled'), 'true');
  assert.match(closed('.lp-hero .lp-closed-note').text(), /sign in/);
});

test('synthetic samples are labelled apart from the real public member example', () => {
  for (const [lang, sampleBadge, real] of [['en', 'Sample data', /real public data/], ['zh', '範例資料', /真實公開資料/]] as const) {
    const $ = load(landingContent(lang, '', stats));
    const caption = $('.lp-hero-shot figcaption');
    assert.equal(caption.find('.lp-badge').text(), sampleBadge);
    const publicLink = caption.find('a[href="/skyhong.tw"]');
    assert.equal(publicLink.length, 1);
    assert.match(publicLink.attr('aria-label') ?? '', real);
    // The hero screenshot itself is not a link to the real dashboard.
    assert.equal($('.lp-hero-shot .lp-screen').is('a'), false);
    // Readable HTML sample for phones, made of synthetic values.
    assert.equal($('.lp-hero-shot .lp-sample').length, 1);
    assert.match($('.lp-sample').attr('aria-label') ?? '', lang === 'en' ? /Synthetic/ : /合成/);
    assert.ok($('.lp-sample-channels li').length >= 3);
  }
});

test('traditional Chinese landing has no English section headings; English stays English', () => {
  const zh = load(landingContent('zh', '', stats));
  const headings = zh('.lp-kicker, h1, h2, h3').map((_, element) => zh(element).text()).get().join(' ');
  for (const english of ['INSIDE URTUBE', 'COMMUNITY', 'START YOUR ARCHIVE', 'OUR COMMUNITY', 'MADE FOR', 'REMEMBERED', 'Product tour', 'Get started']) {
    assert.ok(!headings.toLowerCase().includes(english.toLowerCase()), `${english} in zh headings`);
  }
  assert.match(headings, /社群/);
  const en = load(landingContent('en', '', stats));
  assert.match(en('#community .lp-kicker').first().text(), /Community/);
});

test('channel shelves use correct plurals, a visible scroll hint and large controls', () => {
  const en = load(landingChannelShelf([channel(0, 1, 1), channel(1, 2), channel(2, 5, 1), channel(3, 6)], 'duration', 'en', true));
  const lines = en('.ch-main small').map((_, element) => en(element).text()).get();
  assert.deepEqual(lines, ['Watched by 1 member', 'Watched by 2 members', 'Watched by 5 members', 'Watched by 6 members']);
  assert.match(en('.ch-nums').eq(2).text(), /1 view(?!s)/);
  assert.match(en('.lp-shelf-hint').text(), /see more/);
  assert.equal(en('.ch-shelf [data-ch-scroll]').length, 2);
  // Decorative avatar links stay out of the tab order; the name link is the target.
  assert.equal(en('.ch-main > a').first().attr('tabindex'), '-1');
  const zh = load(landingChannelShelf([channel(0, 1)], 'watches', 'zh'));
  assert.equal(zh('.ch-main small').text(), '1 位會員看過');
  assert.match(zh('.lp-shelf-hint').text(), /滑動/);
  const empty = load(landingChannelShelf([], 'duration', 'en'));
  assert.equal(empty('.ch-shelf').length, 0, 'empty shelves are not wired to the scroll script');
});

test('landing and signup styles keep text at 12px or larger and targets at 44px', () => {
  const pages = [landingContent('en', anonymous('x'), stats), landingContent('zh', anonymous('x'), stats), signupStartPage('', 'en')];
  for (const page of pages) {
    const css = page.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    // signupStartPage includes shared form styles; check only its own block there.
    const own = page === pages[2] ? css.slice(css.indexOf('.ob-start')) : css;
    for (const size of own.matchAll(/font(?:-size)?:(?:[^;}]*?\s)?(\d+(?:\.\d+)?)px/g)) {
      assert.ok(Number(size[1]) >= 12, `font size ${size[0]} is below 12px`);
    }
  }
  assert.match(pages[0], /\.ch-controls button\{[^}]*height:44px[^}]*width:44px/);
});

test('every page sets an initial viewport scale', () => {
  assert.match(shell('Title', '<p>x</p>'), /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('signup explains import choices and privacy defaults without changing the Google flow', () => {
  for (const lang of ['en', 'zh'] as const) {
    const $ = load(signupStartPage('', lang));
    assert.equal($('a.ob-google').attr('href'), '/auth/google');
    const methods = $('.ob-method h3').map((_, element) => $(element).text()).get();
    assert.deepEqual(methods, [lang === 'en' ? 'Chrome extension' : 'Chrome 擴充功能', 'Google Takeout']);
    const checklist = $('.ob-checklist').text();
    if (lang === 'en') {
      for (const phrase of [/takes a while/, /Private by default/, /friend discovery is off/, /Nothing goes public automatically/, /export/, /delete/]) assert.match(checklist, phrase);
      assert.match($('.ob-methods').text(), /100 MB/);
    } else {
      for (const phrase of [/需要一點時間/, /預設私人/, /好友探索關閉/, /不會自動公開/, /匯出/, /刪除/]) assert.match(checklist, phrase);
    }
    assert.equal($('.ob-prep a[href="/privacy"]').length, 1);
  }
  // Errors still render ahead of the Google button.
  const withError = load(signupStartPage('Signups closed', 'en'));
  assert.equal(withError('.ob-card [role=alert]').text(), 'Signups closed');
});

test('the public example nav item is labelled as a real member page, not sample data', () => {
  for (const [lang, label, aria] of [['zh', '公開會員實例', /真實公開資料/], ['en', 'Public member example', /real public data/]] as const) {
    const $ = load(shell('x', '<p>x</p>', primaryNav(lang, { exampleHref: '/sample-owner' }), '', lang));
    const link = $('.site-nav a[href="/sample-owner"]');
    assert.equal(link.find('.nav-short').length ? link.find('.nav-full').text() : link.text(), label);
    assert.match(link.attr('aria-label') ?? '', aria);
  }
  const css = shell('x', '<p>x</p>').match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.match(css, /\.site-nav a\{[^}]*min-height:44px/);
  assert.match(css, /\.site-footer a\{[^}]*min-height:44px/);
});

test('anonymous visitors see channel cards without links to sign-in-only channel pages', () => {
  const signupAction = anonymous('x');
  for (const [lang, note] of [['en', /Channel pages require sign-in/], ['zh', /頻道頁需要登入/]] as const) {
    for (const action of [signupAction, '']) {
      const $ = load(landingContent(lang, action, stats));
      assert.equal($('.ch-row a').length, 0, 'no channel card links for anonymous visitors');
      assert.equal($('a[href^="/channel/"]').length, 0);
      assert.ok($('.ch-row .ch-name').length > 0);
      assert.match($('.lp-channel-note').text(), note);
      assert.equal($('.lp-channel-note a').attr('href'), '/signup');
    }
  }
  const signedIn = load(landingContent('en', '<a class="lp-primary" href="/alex">Open my dashboard →</a>', stats));
  assert.equal(signedIn('.lp-channel-note').length, 0);
  assert.ok(signedIn('.ch-row strong a[href^="/channel/"]').length > 0);
  assert.equal(signedIn('.ch-main > a').first().attr('tabindex'), '-1');
});

test('channels watched by fewer than five members show rounded figures', () => {
  const rows = [
    { ...channel(0, 3, 37), estimatedWatchSeconds: 12.4 * 3600 },
    { ...channel(1, 4, 4), estimatedWatchSeconds: 1200 },
    { ...channel(2, 5, 37), estimatedWatchSeconds: 12.4 * 3600 },
  ];
  const en = load(landingChannelShelf(rows, 'duration', 'en'));
  const nums = en('.ch-nums').map((_, element) => en(element).text()).get();
  assert.deepEqual(nums, ['about 12habout 40 views', 'under 1hunder 10 views', '12.4h37 views']);
  assert.equal(en('.ch-nums.ch-approx').length, 2);
  const zh = load(landingChannelShelf(rows, 'watches', 'zh'));
  assert.deepEqual(zh('.ch-nums strong').map((_, element) => zh(element).text()).get(), ['約 40 次', '不到 10 次', '37 次']);
  assert.equal(zh('.ch-nums span').first().text(), '約 12h');
  // Order and member counts are untouched.
  assert.deepEqual(zh('.ch-main small').map((_, element) => zh(element).text()).get(), ['3 位會員看過', '4 位會員看過', '5 位會員看過']);
  assert.match(load(landingContent('en', '', stats))('.lp-method').text(), /fewer than 5 members show rounded/);
});

test('community timestamp is labelled as calculation time, not import freshness', () => {
  const en = load(landingContent('en', '', stats, freshNow));
  const updated = en('#community > .lp-updated');
  assert.equal(updated.length, 1, 'shown outside the collapsed methodology');
  assert.match(updated.text(), /^Statistics calculated .+\. This is not each member’s last import time\.$/);
  assert.equal(updated.find('time').attr('datetime'), stats.generatedAt);
  const zh = load(landingContent('zh', '', stats, freshNow));
  assert.match(zh('#community > .lp-updated').text(), /^統計計算於 .+，不代表各會員最後匯入時間。$/);
  assert.equal(zh('.lp-more-stats .lp-updated').length, 0);
  assert.equal(load(landingContent('zh', '', { ...stats, status: 'unavailable' }))('.lp-updated').length, 0);
});

test('hero and tour previews are translated synthetic HTML at every width', () => {
  for (const lang of ['en', 'zh'] as const) {
    const page = landingContent(lang, '', stats, freshNow);
    const $ = load(page);
    // No scaled-down screenshot in the hero; the sample sits in the device frame.
    assert.equal($('.lp-hero-shot img').length, 0);
    assert.equal($('.lp-hero-shot .lp-device .lp-sample').length, 1);
    assert.match($('.lp-hero-shot .lp-device-bar').text(), lang === 'en' ? /Sample data/ : /範例資料/);
    assert.equal($('.lp-sample-bars').attr('role'), 'img');
    const heroText = $('.lp-hero-shot .lp-sample').text();
    if (lang === 'en') assert.doesNotMatch(heroText, /[一-鿿]/);
    else assert.match(heroText, /觀看時數/);
    // The tour shows the same translated HTML previews on phones and desktops:
    // no screenshots, no zoom dialog, and nothing that hides the previews.
    assert.equal($('.lp-gallery-window').length, 2);
    assert.equal($('.lp-gallery-window .lp-device .lp-mock').length, 2);
    assert.equal($('.lp-gallery img, .lp-zoom, .lp-zoom-open').length, 0);
    assert.doesNotMatch(page, /\.lp-mock\{display:none\}/);
    assert.doesNotMatch(page, /Screenshots show/);
    $('.lp-gallery-window .lp-mock').each((_, element) => assert.match($(element).attr('aria-label') ?? '', lang === 'en' ? /Synthetic sample/ : /合成範例/));
    assert.match($('.lp-gallery .lp-section-note').text(), lang === 'en' ? /Sample data.*synthetic sample data/ : /範例資料.*合成範例資料/);
    assert.match($('.lp-gallery-window .lp-device-bar').first().text(), lang === 'en' ? /Sample data/ : /範例資料/);
    if (lang === 'en') assert.doesNotMatch($('.lp-gallery').text(), /[一-鿿]/);
  }
  // The score label inside the red circle is white, not the muted grey.
  const css = landingContent('en', '', stats, freshNow);
  assert.match(css, /\.lp-mock-pair>div span\{color:var\(--muted\)/);
  assert.match(css, /\.lp-mock-score span\{color:#fff/);
});

test('anonymous tour links lead to sign-up, signed-in links to the real pages', () => {
  for (const lang of ['en', 'zh'] as const) {
    for (const action of [anonymous('x'), '']) {
      const $ = load(landingContent(lang, action, stats, freshNow));
      const links = $('.lp-gallery-window figcaption a');
      assert.equal(links.length, 2);
      links.each((_, element) => assert.equal($(element).attr('href'), '/signup'));
      assert.match(links.eq(1).text(), lang === 'en' ? /Sign in to explore matching/ : /登入後探索配對/);
      assert.equal($('a[href^="/matches"], a[href^="/channel"], a[href^="/auth"]').length, 0);
    }
    const signedIn = load(landingContent(lang, signedInAction, stats, freshNow));
    const hrefs = signedIn('.lp-gallery-window figcaption a').map((_, element) => signedIn(element).attr('href')).get();
    assert.deepEqual(hrefs, ['/channel/UCRIgIJQWuBJ0Cv_VlU3USNA?range=90d', '/matches']);
  }
});

test('import requirements are summarised before the main action on the landing page and signup', () => {
  for (const [lang, summary] of [['en', /desktop Chrome extension or a ZIP downloaded from Google Takeout ↗\./], ['zh', /桌機 Chrome 擴充功能，或從 Google Takeout ↗ 下載的 ZIP/]] as const) {
    const $ = load(landingContent(lang, anonymous('x'), stats, freshNow));
    const prep = $('.lp-hero .lp-title-block .lp-prep');
    assert.equal(prep.length, 1);
    assert.match(prep.text(), summary);
    assert.match(prep.text(), lang === 'en' ? /take a while/ : /一段時間/);
    // Directly after the hero actions, so phones see it next to the button.
    assert.ok(prep.prevAll('.lp-actions').length === 1);
    assert.equal(prep.find('a[href="https://takeout.google.com/"]').attr('target'), '_blank');
    assert.match(prep.find('a[href="https://takeout.google.com/"]').attr('rel') ?? '', /noopener/);
    assert.equal(prep.find('a[href="/signup#import-methods"]').length, 1);
    assert.equal(load(landingContent(lang, signedInAction, stats, freshNow))('.lp-prep').length, 0, 'not shown to members');

    const signup = load(signupStartPage('', lang));
    const card = signup('.ob-card');
    assert.match(card.find('.ob-prep-summary').text(), summary);
    // The summary precedes the Google button inside the card.
    assert.ok(card.find('.ob-prep-summary').nextAll('a.ob-google').length === 1);
    assert.equal(card.find('.ob-prep-summary a[href="https://takeout.google.com/"]').length, 1);
    assert.equal(card.find('.ob-prep-summary a[href="#import-methods"]').length, 1);
    assert.equal(signup('#import-methods .ob-methods').length, 1, 'the anchor points at the detailed methods');
  }
});

test('community statistics explain their coverage and flag delayed updates', () => {
  for (const lang of ['en', 'zh'] as const) {
    const fresh = load(landingContent(lang, '', stats, freshNow));
    assert.match(fresh('#community > .lp-coverage').text(), lang === 'en'
      ? /^Rankings and totals cover whatever period each public member has imported\. Members do not always keep importing, so recent viewing may be missing\.$/
      : /^排行與總數涵蓋公開會員各自已匯入的期間；會員不一定持續匯入，因此可能不含最近的觀看。$/);
    assert.equal(fresh('.lp-stale, .lp-stale-badge').length, 0);

    // Exactly one hour old is still fresh; anything older is delayed.
    const oneHour = Date.parse(stats.generatedAt) + 3_600_000;
    assert.equal(load(landingContent(lang, '', stats, oneHour))('.lp-stale').length, 0);
    const old = load(landingContent(lang, '', stats, oneHour + 1));
    const stale = old('#community > .lp-stale');
    assert.equal(stale.length, 1);
    assert.equal(stale.attr('role'), 'status');
    // Named for what it measures: the calculation, not source freshness.
    assert.equal(stale.find('.lp-stale-badge').text(), lang === 'en' ? 'Statistics calculation delayed' : '統計計算延遲');
    assert.match(stale.text(), lang === 'en' ? /over an hour/ : /超過 1 小時/);
    assert.match(stale.text(), lang === 'en' ? /reflects only the recalculation, not when members last imported/ : /只反映統計的重新計算，不反映會員最後匯入的時間/);
    assert.doesNotMatch(old('#community').text(), /Data update delayed|資料更新延遲/);
    // The delay notice sits next to the calculation time, and the rankings stay.
    assert.equal(stale.prev().is('.lp-updated'), true);
    assert.ok(old('.ch-row').length > 0);

    const unavailable = load(landingContent(lang, '', { ...stats, status: 'unavailable', generatedAt: new Date(freshNow).toISOString() }, freshNow));
    assert.equal(unavailable('.lp-empty .lp-stale-badge').text(), lang === 'en' ? 'Statistics calculation delayed' : '統計計算延遲');
    assert.equal(unavailable('.lp-coverage, .lp-updated').length, 0);

    const invalid = load(landingContent(lang, '', { ...stats, generatedAt: 'not a date' }, freshNow));
    assert.equal(invalid('.lp-stale').length, 1);
  }
});
