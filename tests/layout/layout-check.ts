// Computed-layout checks for the public pages, run in a real browser:
//   npm run test:layout
// Kept out of `npm test` (no `.test.` in the file name) because it needs a
// Chromium binary. Set URTUBE_LAYOUT_CHROMIUM to a chrome/headless-shell
// executable, or install one with `npx playwright-core install chromium`.
//
// Pages are rendered from synthetic data only: the landing page from a made-up
// CommunityStats object, and /signup, /privacy and a 404 through the app with
// an empty in-memory database. Nothing touches the network; every request is
// answered from memory and anything else is aborted.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createApp } from '../../src/index.js';
import { messages, type Lang } from '../../src/output/i18n.js';
import { landingContent } from '../../src/output/landing.js';
import { primaryNav, shell, type ShellNavItem } from '../../src/output/pages.js';
import { UserRegistry } from '../../src/users.js';
import type { CommunityChannel, CommunityStats } from '../../src/youtube/community.js';

const ORIGIN = 'http://layout.test';
const WIDTHS = [320, 360, 390, 414, 768, 1440] as const;
const HEIGHTS: Record<number, number> = { 320: 568, 360: 740, 390: 844, 414: 896, 768: 1024, 1440: 900 };
const LANGS = ['en', 'zh'] as const;
// Phones get a two-row header at most (brand, then navigation).
const PHONE_HEADER_MAX = 100;
const MIN_FONT_PX = 12;
const MIN_TARGET_PX = 24;

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

type PageKind = 'home' | 'home-signed-in' | 'home-delayed' | 'signup' | 'privacy' | '404' | 'regression-long-label';
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

async function renderAll(): Promise<Map<string, Rendered>> {
  const pages = new Map<string, Rendered>();
  const app = createApp(new UserRegistry(':memory:'));
  for (const lang of LANGS) {
    const add = (kind: PageKind, status: number, body: string) => pages.set(`/${kind}/${lang}`, { kind, lang, status, body });
    add('home', 200, landing(lang, false, fresh));
    add('home-signed-in', 200, landing(lang, true, fresh));
    add('home-delayed', 200, landing(lang, false, delayed));
    for (const [kind, path] of [['signup', '/signup'], ['privacy', '/privacy'], ['404', '/no-such-page/for-layout']] as const) {
      const response = await app.request(`${path}?lang=${lang}`);
      add(kind, response.status, await response.text());
    }
  }
  // Negative control: the phone header must notice a label that is too long
  // (the regression that once pushed the language switch off screen).
  const long = primaryNav('en', { exampleHref: '/sample-1', languageHref: '/?lang=zh' })
    .map(item => item.shortLabel ? { ...item, shortLabel: undefined } : item);
  pages.set('/regression-long-label/en', { kind: 'regression-long-label', lang: 'en', status: 200, body: landing('en', false, fresh, long) });
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
  return page.evaluate(({ kind, minFont, minTarget, phoneHeaderMax }) => {
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
    // Brand row plus one menu row. Signed-in members have five menu items,
    // which need a second menu row below 390px.
    const headerMax = kind === 'home-signed-in' && vw < 390 ? phoneHeaderMax + 48 : phoneHeaderMax;
    if (vw <= 480 && headerHeight > headerMax) failures.push(`phone header is ${Math.round(headerHeight)}px tall (max ${headerMax})`);

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

    // 4. Every visible interactive target is at least minTarget × minTarget.
    const targets = document.querySelectorAll('a[href],button,summary,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])');
    for (const target of targets) {
      if (!visible(target) || target.classList.contains('skip-link')) continue;
      const rect = target.getBoundingClientRect();
      if (rect.height < minTarget - 0.5 || rect.width < minTarget - 0.5) failures.push(`target below ${minTarget}px: ${describe(target)} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
    }

    // 5. The page's main call to action is on the first screen.
    const ctaSelector = { home: '.lp-hero .lp-primary', 'home-signed-in': '.lp-hero .lp-primary', 'home-delayed': '.lp-hero .lp-primary', 'regression-long-label': '.lp-hero .lp-primary', signup: 'a.ob-google', '404': 'main a[href="/"]', privacy: 'main h1' }[kind];
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
  }, { kind, minFont: MIN_FONT_PX, minTarget: MIN_TARGET_PX, phoneHeaderMax: PHONE_HEADER_MAX });
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

describe('public page layout in a real browser', () => {
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

  for (const kind of ['home', 'home-signed-in', 'home-delayed', 'signup', 'privacy', '404'] as const) {
    for (const lang of LANGS) {
      test(`${kind} (${lang})`, async () => {
        const rendered = pages.get(`/${kind}/${lang}`)!;
        assert.equal(rendered.status, kind === '404' ? 404 : 200, `${kind} renders`);
        const problems: string[] = [];
        for (const width of WIDTHS) {
          const page = await open(width, `/${kind}/${lang}`);
          try {
            const report = await inspect(page, kind);
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
});
