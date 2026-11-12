// Computed-layout checks for the public and signed-in pages, run in a real
// browser:
//   npm run test:layout
// Kept out of `npm test` (no `.test.` in the file name) because it needs a
// Chromium binary. Set URTUBE_LAYOUT_CHROMIUM to a chrome/headless-shell
// executable, or install one with `npx playwright-core install chromium`.
//
// URTUBE_LAYOUT_SUMMARY=1 prints header and page heights per page and width;
// URTUBE_LAYOUT_SCREENSHOTS=<dir> also saves full-page screenshots.
//
// Pages are rendered from synthetic data only: the landing page from a made-up
// CommunityStats object; /signup, /privacy and a 404 through the app with an
// empty in-memory database; and the signed-in pages (dashboard, /matches,
// /account and each onboarding step) through the app with made-up members in
// an in-memory registry and test sessions. Nothing touches the network; every
// request is answered from memory and anything else is aborted.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createApp } from '../../src/index.js';
import { messages, type Lang } from '../../src/output/i18n.js';
import { landingContent } from '../../src/output/landing.js';
import { primaryNav, shell, type ShellNavItem } from '../../src/output/pages.js';
import { UserRegistry, type User } from '../../src/users.js';
import type { CommunityChannel, CommunityStats } from '../../src/youtube/community.js';
import { MATCHING_TAXONOMY } from '../../src/youtube/matching.js';
import { REGISTRY_CRYSTAL_VERSION, type RegistryMatchingCrystal } from '../../src/youtube/registry-crystal.js';

const ORIGIN = 'http://layout.test';
// 751 and 760 sit between the landing page's sticky breakpoint and the
// two-row header breakpoint, which once disagreed.
const WIDTHS = [320, 360, 390, 414, 751, 760, 768, 1440] as const;
const HEIGHTS: Record<number, number> = { 320: 568, 360: 740, 390: 844, 414: 896, 751: 1024, 760: 1024, 768: 1024, 1440: 900 };
const LANGS = ['en', 'zh'] as const;
// Phones get a two-row header at most (brand, then navigation), signed in or not.
const PHONE_HEADER_MAX = 100;
const MIN_FONT_PX = 12;
// Controls (header links, buttons, form fields, summaries, block links) need
// the product's 44px touch target; links inside running text need 24px.
const MIN_CONTROL_PX = 44;
const MIN_INLINE_LINK_PX = 24;
// WCAG AA text contrast: 4.5:1, or 3:1 for large text.
const MIN_CONTRAST = 4.5;
const MIN_LARGE_CONTRAST = 3;

const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const names = ['Open Lab', 'Sound Room with a Rather Long Channel Name', 'Design Notes', 'Small Adventures', '料理研究所 Kitchen Lab', 'Science Hour', 'Night Drive Radio', 'Maps & Places', 'Quiet Piano', 'Retro Games Archive', 'Daily Typography', 'Weekend Hikes'];
const channels: CommunityChannel[] = names.map((name, index) => ({
  id: 'UC' + String.fromCharCode(97 + index).repeat(22),
  name,
  members: index % 3 === 0 ? 7 : 3,
  watches: 240 - index * 13,
  estimatedWatchSeconds: (60 - index * 3) * 3600,
  thumbnailUrl: '',
}));
const stats = (generatedAt: string): CommunityStats => ({
  status: 'ready', generatedAt, publicMembers: 12, activeMembers: 11, watches: 4210, channels: 380, estimatedWatchSeconds: 920 * 3600,
  topChannels: channels, topDurationChannels: channels, topWatchedChannels: [...channels].reverse(),
  profiles: Array.from({ length: 6 }, (_, index) => ({ handle: `sample-${index + 1}`, displayName: `Sample Member ${index + 1}` })),
});
const fresh = stats(new Date(NOW - 5 * 60_000).toISOString());
const delayed = stats(new Date(NOW - 2 * 3600_000).toISOString());

const PUBLIC_KINDS = ['home', 'home-signed-in', 'home-delayed', 'signup', 'privacy', '404'] as const;
const SIGNED_IN_KINDS = ['dashboard', 'matches', 'account', 'onboarding-setup', 'onboarding-processing', 'onboarding-consent'] as const;
type PageKind = typeof PUBLIC_KINDS[number] | typeof SIGNED_IN_KINDS[number] | 'regression-long-label' | 'regression-small-button';
interface Rendered { kind: PageKind; lang: Lang; status: number; body: string }

function landing(lang: Lang, signedIn: boolean, data: CommunityStats, nav?: ShellNavItem[]): string {
  const t = messages(lang);
  const action = signedIn ? `<a class="lp-primary" href="/sample-1">${t.landingMyDashboard}</a>` : `<a class="lp-primary" href="/signup">${t.landingCta}</a>`;
  const other = lang === 'zh' ? 'en' : 'zh';
  const navItems = nav ?? primaryNav(lang, signedIn
    ? { dashboardHref: '/sample-1', languageHref: `/?lang=${other}` }
    : { exampleHref: '/sample-1', languageHref: `/?lang=${other}` });
  return shell(lang === 'zh' ? '你的 YouTube 人生，都記得。' : 'Your YouTube life, remembered.', landingContent(lang, action, data, NOW), navItems, '', lang, '/');
}

// Synthetic members for the signed-in pages. Channel and video names are made
// up; watch times are spread over the last 90 days before the test runs.
const syntheticChannels = ['Open Lab', 'Sound Room', 'Design Notes', 'Small Adventures', '料理研究所 Kitchen Lab', 'Science Hour'];

function seedHistory(registry: UserRegistry, user: User, count: number): void {
  const start = Date.now();
  registry.repositoryFor(user).ingestYoutubeArchive({
    archiveHash: `layout-${user.handle}`,
    source: 'takeout',
    watches: Array.from({ length: count }, (_, index) => {
      const channel = index % syntheticChannels.length;
      const channelId = 'UClayout' + String(channel).padStart(16, '0');
      const videoId = 'LAYOUT' + String(index).padStart(5, '0');
      return {
        eventId: `layout-${user.handle}-${index}`,
        videoId,
        title: `Synthetic video ${index + 1} about ${syntheticChannels[channel]}`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        channelId,
        channelTitle: syntheticChannels[channel]!,
        channelUrl: `https://www.youtube.com/channel/${channelId}`,
        watchedAt: new Date(start - (index * 17 + 3) * 3600_000).toISOString(),
        actualWatchedSeconds: 300 + (index * 97) % 1500,
        activityType: 'video' as const,
      };
    }),
    searches: [],
  });
}

function eligibleCrystal(shares: [string, number][]): RegistryMatchingCrystal {
  const name = (key: string) => MATCHING_TAXONOMY.topics.find(topic => topic.key === key)?.name ?? key;
  return {
    kind: 'matching',
    version: REGISTRY_CRYSTAL_VERSION,
    taxonomyVersion: MATCHING_TAXONOMY.version,
    generatedAt: new Date().toISOString(),
    windowDays: 90,
    data: { watchEvents: 240, uniqueVideos: 90, estimatedWatchSeconds: 120_000, activeDays: 20, topicCoverage: 1 },
    topics: shares.map(([key, share]) => ({ key, name: name(key), share })),
    channels: [{ key: 'open-lab', name: 'Open Lab', share: 1 }],
  };
}

// Signed-in pages, rendered by the app for made-up members in an in-memory
// registry. Returns the session cookie each page is requested with.
function signedInFixture(registry: UserRegistry): Record<typeof SIGNED_IN_KINDS[number], { path: string; cookie: string }> {
  const session = (user: User) => `urtube_session=${registry.createSession(user)}`;
  const member = registry.createUser('layout-member', 'Alex Sample Member');
  seedHistory(registry, member, 120);
  registry.upsertMatchingCrystal(member, eligibleCrystal([['music', 0.5], ['gaming', 0.3], ['education', 0.2]]));
  registry.completeOnboarding(member.handle, true, 'topics_and_channel', true);
  for (const [handle, name, shares] of [['layout-mia', 'Mia Sample', [['music', 0.6], ['education', 0.4]]], ['layout-sam', 'Sam Sample With A Longer Display Name', [['gaming', 0.7], ['music', 0.3]]]] as const) {
    const friend = registry.createUser(handle, name);
    seedHistory(registry, friend, 40);
    registry.upsertMatchingCrystal(friend, eligibleCrystal(shares.map(([key, share]) => [key, share])));
    registry.completeOnboarding(friend.handle, true, 'topics_and_channel', true);
  }
  const fresh = registry.createUser('layout-new', 'New Sample');
  const processing = registry.createUser('layout-processing', 'Processing Sample');
  seedHistory(registry, processing, 20);
  const consent = registry.createUser('layout-consent', 'Consent Sample');
  seedHistory(registry, consent, 60);
  registry.upsertMatchingCrystal(consent, eligibleCrystal([['music', 0.65], ['gaming', 0.35]]));
  const memberCookie = session(registry.userByHandle(member.handle)!);
  return {
    dashboard: { path: `/${member.handle}`, cookie: memberCookie },
    matches: { path: '/matches', cookie: memberCookie },
    account: { path: '/account', cookie: memberCookie },
    'onboarding-setup': { path: '/onboarding', cookie: session(fresh) },
    'onboarding-processing': { path: '/onboarding', cookie: session(processing) },
    'onboarding-consent': { path: '/onboarding', cookie: session(consent) },
  };
}

async function renderAll(): Promise<Map<string, Rendered>> {
  const pages = new Map<string, Rendered>();
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  const signedIn = signedInFixture(registry);
  for (const lang of LANGS) {
    const add = (kind: PageKind, status: number, body: string) => pages.set(`/${kind}/${lang}`, { kind, lang, status, body });
    add('home', 200, landing(lang, false, fresh));
    add('home-signed-in', 200, landing(lang, true, fresh));
    add('home-delayed', 200, landing(lang, false, delayed));
    for (const [kind, path] of [['signup', '/signup'], ['privacy', '/privacy'], ['404', '/no-such-page/for-layout']] as const) {
      const response = await app.request(`${path}?lang=${lang}`);
      add(kind, response.status, await response.text());
    }
    for (const kind of SIGNED_IN_KINDS) {
      const { path, cookie } = signedIn[kind];
      const response = await app.request(`${path}?lang=${lang}`, { headers: { cookie } });
      add(kind, response.status, await response.text());
    }
  }
  // Negative control: the phone header must notice a label that is too long
  // (the regression that once pushed the language switch off screen).
  const long = primaryNav('en', { exampleHref: '/sample-1', languageHref: '/?lang=zh' })
    .map(item => item.shortLabel ? { ...item, shortLabel: undefined } : item);
  pages.set('/regression-long-label/en', { kind: 'regression-long-label', lang: 'en', status: 200, body: landing('en', false, fresh, long) });
  // Negative control: a 40px-tall button must fail the 44px control check.
  const small = landing('en', false, fresh).replace('</style>', '.lp-hero .lp-actions>a{min-height:0;padding-block:8px;height:40px}</style>');
  pages.set('/regression-small-button/en', { kind: 'regression-small-button', lang: 'en', status: 200, body: small });
  registry.close();
  return pages;
}

interface Report {
  failures: string[];
  headerHeight: number;
  docHeight: number;
  google?: { height: number; lines: number };
}

// Runs inside the page. Returns human-readable failures plus a few metrics.
async function inspect(page: Page, kind: PageKind): Promise<Report> {
  return page.evaluate(({ kind, minFont, minControl, minInline, minContrast, minLargeContrast, phoneHeaderMax }) => {
    const failures: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const describe = (element: Element) => {
      const text = (element.getAttribute('aria-label') || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `<${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? '.' + element.className.split(' ')[0] : ''}> "${text}"`;
    };
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      if (element.closest('details:not([open])') && !element.closest('summary')) return false;
      return true;
    };

    // 1. Header: every item fully inside the viewport, not clipped, no overlap,
    //    and keyboard order follows the visual reading order.
    const header = document.querySelector('.site-header')!;
    const items = [header.querySelector('.site-brand')!, ...header.querySelectorAll('.site-nav a')];
    const rects = items.map(item => item.getBoundingClientRect());
    items.forEach((item, index) => {
      const rect = rects[index]!;
      if (rect.left < -0.5 || rect.right > vw + 0.5 || rect.top < -0.5) failures.push(`header item outside viewport: ${describe(item)} [${Math.round(rect.left)}–${Math.round(rect.right)} of ${vw}]`);
      if (item.scrollWidth > item.clientWidth + 1) failures.push(`header item text clipped: ${describe(item)}`);
      for (let other = index + 1; other < items.length; other++) {
        const b = rects[other]!;
        const overlapX = Math.min(rect.right, b.right) - Math.max(rect.left, b.left);
        const overlapY = Math.min(rect.bottom, b.bottom) - Math.max(rect.top, b.top);
        if (overlapX > 0.5 && overlapY > 0.5) failures.push(`header items overlap: ${describe(item)} and ${describe(items[other]!)}`);
      }
    });
    const visualOrder = items.map((item, index) => ({ index, rect: rects[index]! }))
      .sort((a, b) => Math.abs(a.rect.top - b.rect.top) > 8 ? a.rect.top - b.rect.top : a.rect.left - b.rect.left)
      .map(entry => entry.index);
    if (visualOrder.some((value, index) => value !== index)) failures.push(`header tab order differs from visual order: visual ${visualOrder.join(',')}`);
    const headerHeight = header.getBoundingClientRect().height;
    // Brand row plus one menu row, for anonymous and signed-in menus alike.
    if (vw <= 480 && headerHeight > phoneHeaderMax) failures.push(`phone header is ${Math.round(headerHeight)}px tall (max ${phoneHeaderMax})`);
    // A header that wraps onto two rows scrolls away instead of staying fixed
    // over the content.
    const headerPosition = getComputedStyle(header).position;
    const stacked = header.querySelector('.site-nav')!.getBoundingClientRect().top >= rects[0]!.bottom - 1;
    if (stacked && (headerPosition === 'sticky' || headerPosition === 'fixed')) failures.push(`two-row ${Math.round(headerHeight)}px header stays fixed on screen (${headerPosition})`);

    // 2. No horizontal page scroll.
    const scrollWidth = document.documentElement.scrollWidth;
    if (scrollWidth > vw) failures.push(`horizontal overflow: scrollWidth ${scrollWidth} > ${vw}`);

    // 3. No visible text below the minimum size.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const small = new Set<string>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,noscript') || !visible(parent)) continue;
      const size = parseFloat(getComputedStyle(parent).fontSize);
      if (size < minFont) small.add(`${size}px ${describe(parent)}`);
    }
    for (const entry of small) failures.push(`text below ${minFont}px: ${entry}`);

    // 3b. Text contrast against the composited background (WCAG AA). Text
    //     over an image or gradient is skipped: its background is not a colour.
    const parseColor = (value: string): [number, number, number, number] | null => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
    };
    const over = (top: [number, number, number, number], bottom: [number, number, number]): [number, number, number] =>
      [0, 1, 2].map(index => top[index]! * top[3] + bottom[index]! * (1 - top[3])) as [number, number, number];
    const luminance = (rgb: [number, number, number]) => {
      const [r, g, b] = rgb.map(channel => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const backgroundOf = (element: Element): [number, number, number] | null => {
      const layers: [number, number, number, number][] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node !== document.body && node !== document.documentElement && style.backgroundImage !== 'none') return null;
        const color = parseColor(style.backgroundColor);
        if (color && color[3] > 0) {
          layers.push(color);
          if (color[3] >= 1) break;
        }
      }
      let base: [number, number, number] = [255, 255, 255];
      for (const layer of layers.reverse()) base = over(layer, base);
      return base;
    };
    const lowContrast = new Set<string>();
    const contrastWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = contrastWalker.nextNode(); node; node = contrastWalker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,noscript,[aria-hidden="true"],[aria-disabled="true"],:disabled') || !visible(parent)) continue;
      const style = getComputedStyle(parent);
      if (parseFloat(style.opacity) < 1) continue;
      const background = backgroundOf(parent);
      const ink = parseColor(style.color);
      if (!background || !ink) continue;
      const text = over(ink, background);
      const [light, dark] = [luminance(text), luminance(background)].sort((a, b) => b - a);
      const ratio = (light! + 0.05) / (dark! + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const needed = large ? minLargeContrast : minContrast;
      if (ratio < needed) lowContrast.add(`${ratio.toFixed(2)}:1 ${describe(parent)}`);
    }
    for (const entry of lowContrast) failures.push(`text contrast below AA: ${entry}`);

    // 4. Touch targets. Controls need minControl in both directions: header
    //    links, buttons, form fields, summaries, and links drawn as buttons,
    //    pills or cards (with a background or border). Other links (in
    //    running text, lists and word clouds) need minInline.
    const filled = (style: CSSStyleDeclaration) => (parseColor(style.backgroundColor)?.[3] ?? 0) > 0
      || style.backgroundImage !== 'none'
      || ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none');
    const targets = document.querySelectorAll('a[href],button,summary,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])');
    for (const target of targets) {
      if (!visible(target) || target.classList.contains('skip-link')) continue;
      // A checkbox or radio is operated through its label.
      const box = target.matches('input[type=checkbox],input[type=radio]') ? target.closest('label') ?? target : target;
      const rect = box.getBoundingClientRect();
      const textLink = target.tagName === 'A' && !target.closest('.site-header') && !filled(getComputedStyle(target));
      const min = textLink ? minInline : minControl;
      if (rect.height < min - 0.5 || rect.width < min - 0.5) failures.push(`${textLink ? 'text link' : 'control'} below ${min}px: ${describe(box)} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
    }

    // 5. The page's main call to action is on the first screen.
    const ctaSelector = { home: '.lp-hero .lp-primary', 'home-signed-in': '.lp-hero .lp-primary', 'home-delayed': '.lp-hero .lp-primary', 'regression-long-label': '.lp-hero .lp-primary', 'regression-small-button': '.lp-hero .lp-primary', signup: 'a.ob-google', '404': 'main a[href="/"]', privacy: 'main h1', dashboard: 'main h1', matches: 'main h1', account: 'main h1', 'onboarding-setup': 'main h1', 'onboarding-processing': 'main h1', 'onboarding-consent': 'main h1' }[kind];
    const cta = document.querySelector(ctaSelector);
    if (!cta) failures.push(`missing call to action ${ctaSelector}`);
    else {
      const rect = cta.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > vh) failures.push(`call to action below the fold: ${describe(cta)} bottom ${Math.round(rect.bottom)} > ${vh}`);
    }

    // The Google button keeps its label on one line, or centres it on two.
    let google: Report['google'];
    const button = document.querySelector<HTMLElement>('a.ob-google');
    if (button) {
      const label = button.querySelector('span') ?? button;
      const range = document.createRange();
      range.selectNodeContents(label);
      const lines = new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size;
      google = { height: Math.round(button.getBoundingClientRect().height), lines };
      if (lines > 1 && getComputedStyle(label).textAlign !== 'center') failures.push('Google button label wraps without centring');
      if (lines > 2) failures.push(`Google button label wraps to ${lines} lines`);
      // From 360px up the label fits on one line.
      if (vw >= 360 && lines > 1) failures.push(`Google button label wraps at ${vw}px`);
    }

    // The delayed state names what is delayed: the calculation.
    if (kind === 'home-delayed' && !document.querySelector('.lp-stale')) failures.push('delayed statistics badge missing');

    return { failures, headerHeight: Math.round(headerHeight), docHeight: document.documentElement.scrollHeight, google };
  }, { kind, minFont: MIN_FONT_PX, minControl: MIN_CONTROL_PX, minInline: MIN_INLINE_LINK_PX, minContrast: MIN_CONTRAST, minLargeContrast: MIN_LARGE_CONTRAST, phoneHeaderMax: PHONE_HEADER_MAX });
}

// In-page anchors must not land underneath the sticky landing header.
async function anchorClearsHeader(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const target = document.getElementById('community')!;
    document.documentElement.style.scrollBehavior = 'auto';
    target.scrollIntoView({ block: 'start' });
    const header = document.querySelector('.site-header')!.getBoundingClientRect();
    const top = target.getBoundingClientRect().top;
    window.scrollTo(0, 0);
    return top + 0.5 < header.bottom ? `#community starts ${Math.round(header.bottom - top)}px under the sticky header` : undefined;
  });
}

// Keyboard order through the header: brand first, then each item left to
// right, top to bottom (no jump back to an earlier row).
async function tabOrder(page: Page): Promise<string[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen: string[] = [];
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || !element.closest('.site-header')) return null;
      const rect = element.getBoundingClientRect();
      return { label: (element.textContent ?? '').trim().slice(0, 20), top: rect.top, left: rect.left };
    });
    if (!info) { if (seen.length) break; else continue; }
    seen.push(`${info.label}@${Math.round(info.top)},${Math.round(info.left)}`);
  }
  return seen;
}

describe('page layout in a real browser', () => {
  let browser: Browser;
  let pages: Map<string, Rendered>;
  const summary: string[] = [];

  before(async () => {
    pages = await renderAll();
    browser = await chromium.launch({ executablePath: process.env.URTUBE_LAYOUT_CHROMIUM || undefined });
  });
  after(async () => {
    await browser?.close();
    if (process.env.URTUBE_LAYOUT_SUMMARY) console.log(summary.join('\n'));
  });

  async function open(width: number, path: string): Promise<Page> {
    const context = await browser.newContext({ viewport: { width, height: HEIGHTS[width]! }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    // tsx keeps function names with an `__name` helper that only exists in
    // Node; give the page a no-op copy so evaluated callbacks run.
    await context.addInitScript('globalThis.__name = (fn) => fn;');
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      const rendered = url.origin === ORIGIN ? pages.get(url.pathname) : undefined;
      if (rendered) return route.fulfill({ status: rendered.status, contentType: 'text/html; charset=utf-8', body: rendered.body });
      if (url.origin === ORIGIN) return route.fulfill({ status: 404, body: '' });
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(ORIGIN + path, { waitUntil: 'load' });
    return page;
  }

  for (const kind of [...PUBLIC_KINDS, ...SIGNED_IN_KINDS]) {
    for (const lang of LANGS) {
      test(`${kind} (${lang})`, async () => {
        const rendered = pages.get(`/${kind}/${lang}`)!;
        assert.equal(rendered.status, kind === '404' ? 404 : 200, `${kind} renders`);
        const problems: string[] = [];
        for (const width of WIDTHS) {
          const page = await open(width, `/${kind}/${lang}`);
          try {
            const report = await inspect(page, kind);
            // URTUBE_LAYOUT_SCREENSHOTS=<dir> saves a full-page capture of each
            // page and width for visual review (synthetic data only).
            if (process.env.URTUBE_LAYOUT_SCREENSHOTS) await page.screenshot({ path: `${process.env.URTUBE_LAYOUT_SCREENSHOTS}/${kind}-${lang}-${width}.png`, fullPage: true });
            problems.push(...report.failures.map(failure => `${width}px: ${failure}`));
            if (kind.startsWith('home')) {
              const anchor = await anchorClearsHeader(page);
              if (anchor) problems.push(`${width}px: ${anchor}`);
            }
            if (width <= 414) {
              const order = await tabOrder(page);
              const tops = order.map(entry => Number(entry.split('@')[1]!.split(',')[0]));
              if (tops.some((top, index) => index > 0 && top < tops[index - 1]! - 8)) problems.push(`${width}px: keyboard focus jumps back up in the header: ${order.join(' → ')}`);
            }
            summary.push(`${kind}\t${lang}\t${width}\theader=${report.headerHeight}\tpage=${report.docHeight}${report.google ? `\tgoogle=${report.google.height}px/${report.google.lines} line(s)` : ''}`);
          } finally {
            await page.context().close();
          }
        }
        assert.deepEqual(problems, []);
      });
    }
  }

  test('negative control: a long phone label is caught', async () => {
    const page = await open(320, '/regression-long-label/en');
    try {
      const report = await inspect(page, 'regression-long-label');
      assert.ok(report.failures.some(failure => /header/.test(failure)), `expected a header failure, got ${JSON.stringify(report.failures)}`);
    } finally {
      await page.context().close();
    }
  });

  test('negative control: a 40px button is caught', async () => {
    const page = await open(390, '/regression-small-button/en');
    try {
      const report = await inspect(page, 'regression-small-button');
      assert.ok(report.failures.some(failure => /control below 44px: <a\.lp-primary>.*×40$/.test(failure)), `expected a 44px failure, got ${JSON.stringify(report.failures)}`);
    } finally {
      await page.context().close();
    }
  });
});
