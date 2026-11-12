import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { landingContent } from '../src/output/landing.js';
import { landingChannelShelf } from '../src/output/landing-channels.js';
import { signupStartPage } from '../src/output/onboarding.js';
import { shell } from '../src/output/pages.js';
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
  const en = load(landingChannelShelf([channel(0, 1, 1), channel(1, 2)], 'duration', 'en'));
  const lines = en('.ch-main small').map((_, element) => en(element).text()).get();
  assert.deepEqual(lines, ['Watched by 1 member', 'Watched by 2 members']);
  assert.match(en('.ch-nums').first().text(), /1 view(?!s)/);
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
