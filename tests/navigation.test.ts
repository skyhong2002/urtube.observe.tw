import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { primaryNav, shell } from '../src/output/pages.js';
import { DEFAULT_HANDLE, UserRegistry } from '../src/users.js';

interface RenderedNavLink {
  label: string;
  href: string;
  active: boolean;
}

function renderedNav(markup: string): RenderedNavLink[] {
  const nav = markup.match(/<nav class="site-nav"[^>]*>(.*?)<\/nav>/s)?.[1];
  assert.ok(nav, 'page renders the shared primary navigation');
  return [...nav.matchAll(/<a href="([^"]+)"([^>]*)>(.*?)<\/a>/g)].map((match) => ({
    href: match[1]!.replaceAll('&amp;', '&'),
    active: match[2]!.includes('aria-current="page"'),
    // Full label; a phone-only short label is a separate span.
    label: match[3]!.replace(/<span class="nav-short">.*?<\/span>/, '').replace(/<[^>]+>/g, ''),
  }));
}

test('primary navigation has one anonymous and one signed-in contract in both languages', () => {
  assert.deepEqual(primaryNav('zh', {
    active: 'signup', exampleHref: '/demo', languageHref: '/signup?lang=en',
  }), [
    { label: '註冊／登入', href: '/signup', active: true },
    { label: '公開成員實例', shortLabel: '公開成員實例', href: '/demo', active: false, ariaLabel: '公開成員實例：一位真實成員的公開儀表板（真實公開資料，不是合成範例）' },
    { label: 'EN', href: '/signup?lang=en', language: true },
  ]);
  assert.deepEqual(primaryNav('en', {
    active: 'matches', dashboardHref: '/alex', languageHref: '/matches?lang=zh',
  }), [
    // Phones show the short form so five items fit on one row.
    { label: 'Dashboard', shortLabel: 'You', ariaLabel: 'Your dashboard', href: '/alex', active: false },
    { label: 'Channels', href: '/channel/', active: false },
    { label: 'Matches', href: '/matches', active: true },
    { label: 'Settings', href: '/account', active: false },
    { label: '中文', href: '/matches?lang=zh', language: true },
  ]);
});

test('anonymous pages share navigation and use one registration/sign-in term', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    registry.ensureDefaultUser();
    const cases = [
      ['/?lang=zh', undefined, `/?lang=en`],
      ['/signup?lang=zh', '註冊／登入', '/signup?lang=en'],
      ['/privacy?lang=zh', undefined, '/privacy?lang=en'],
      [`/${DEFAULT_HANDLE}?range=90d&lang=zh`, '公開成員實例', `/${DEFAULT_HANDLE}?range=90d&lang=en`],
    ] as const;
    for (const [path, active, languageHref] of cases) {
      const response = await app.request(path);
      assert.ok(response.status === 200, `${path} renders successfully`);
      const links = renderedNav(await response.text());
      assert.deepEqual(links.map((link) => link.label), ['註冊／登入', '公開成員實例', 'EN']);
      assert.equal(links.find((link) => link.active)?.label, active);
      assert.equal(links.at(-1)?.href, languageHref);
    }

    const signup = await (await app.request('/signup?lang=zh')).text();
    assert.match(signup, /<h1>註冊／登入<\/h1>/);
    assert.match(signup, /><span>使用 Google 註冊／登入<\/span><\/a>/);
    assert.doesNotMatch(signup, />建立檔案館<\/a>/);

    const signupEn = await (await app.request('/signup?lang=en')).text();
    assert.match(signupEn, /<h1>Sign up \/ sign in<\/h1>/);
    assert.match(signupEn, /><span>Sign up \/ sign in with Google<\/span><\/a>/);
  } finally {
    registry.close();
  }
});

test('signed-in pages share navigation, active state, and query-preserving language links', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const user = registry.createUser('alex', 'Alex', {
      googleSub: 'navigation-google-sub', googleEmail: 'alex@example.test',
    });
    const cookie = `urtube_session=${registry.createSession(user)}`;
    const cases = [
      ['/?lang=zh', undefined, '/?lang=en'],
      ['/alex?range=90d&sort=watches&lang=zh', '儀表板', '/alex?range=90d&sort=watches&lang=en'],
      ['/channel/?range=90d&sort=watches&lang=zh', '頻道', '/channel/?range=90d&sort=watches&q=&lang=en'],
      ['/matches?page=2&lang=zh', '配對', '/matches?page=2&lang=en'],
      ['/account?lang=zh', '設定', '/account?lang=en'],
      ['/onboarding?lang=zh', undefined, '/onboarding?lang=en'],
      ['/extension-setup?lang=zh', '設定', '/extension-setup?lang=en'],
    ] as const;
    for (const [path, active, languageHref] of cases) {
      const response = await app.request(path, { headers: { cookie } });
      assert.ok(response.status === 200 || response.status === 403, `${path} renders a complete page`);
      const links = renderedNav(await response.text());
      assert.deepEqual(links.map((link) => link.label), ['儀表板', '頻道', '配對', '設定', 'EN']);
      assert.equal(links.find((link) => link.active)?.label, active);
      assert.equal(links.at(-1)?.href, languageHref);
    }
  } finally {
    registry.close();
  }
});

test('shared shell keeps the full menu usable at phone widths', () => {
  const page = shell('Navigation test', '', primaryNav('en', { dashboardHref: '/alex' }));
  // Computed positions at 320–1440px are checked in a browser by
  // `npm run test:layout` (tests/layout/layout-check.ts).
  assert.match(page, /@media\(max-width:760px\)\{\.site-header\{align-items:stretch;flex-direction:column/);
  // Items wrap instead of hiding behind an unmarked horizontal scroll.
  assert.match(page, /\.site-nav\{display:flex;flex-wrap:wrap;/);
  assert.doesNotMatch(page, /\.site-nav\{[^}]*overflow-x/);
  assert.match(page, /aria-label="Primary navigation"/);
});

test('long nav labels get a short phone label while keeping the full accessible name', () => {
  const en = shell('x', '', primaryNav('en', { exampleHref: '/demo' }), '', 'en');
  const link = en.match(/<a href="\/demo"([^>]*)>(.*?)<\/a>/)!;
  assert.match(link[1]!, /aria-label="Public member example: a real member’s public dashboard/);
  assert.equal(link[2], '<span class="nav-full">Public member example</span><span class="nav-short">Member example</span>');
  assert.match(en, /@media\(max-width:480px\)\{[^\n]*\.site-nav \.nav-full\{display:none\}\.site-nav \.nav-short\{display:inline\}/);
  assert.match(en, /\.site-nav \.nav-short\{display:none\}/);
  // Chinese already fits at 320px, so it renders one plain label.
  const zh = shell('x', '', primaryNav('zh', { exampleHref: '/demo' }), '', 'zh');
  assert.match(zh, /<a href="\/demo" aria-label="[^"]+">公開成員實例<\/a>/);
  // Items without an aria-label never swap labels.
  assert.equal(shell('x', '', [{ label: 'Long label', shortLabel: 'Short', href: '/x' }]).includes('nav-short">Short'), false);
  // The language switch is last in the menu's DOM and tab order, and phones
  // show it at the end of the menu row (not above it, which made keyboard
  // focus jump back up).
  assert.match(en, /<a href="[^"]*" class="nav-lang">中文<\/a><\/nav>/);
  assert.doesNotMatch(en, /\.nav-lang\{[^}]*position:absolute/);
  assert.match(en, /\.site-nav a\{[^}]*min-height:44px;min-width:44px/);
  // Brand and skip link meet the 44px target as well.
  assert.match(en, /\.site-brand\{[^}]*min-height:44px/);
  assert.match(en, /\.skip-link\{[^}]*min-height:44px/);
});

test('no link an anonymous visitor sees on public pages bounces to Google sign-in', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    registry.ensureDefaultUser();
    const checked = new Set<string>();
    for (const page of ['/?lang=en', '/?lang=zh', '/signup?lang=en', '/signup?lang=zh', '/privacy?lang=en', '/privacy?lang=zh']) {
      const markup = await (await app.request(page)).text();
      const hrefs = [...markup.matchAll(/href="([^"]+)"/g)].map(match => match[1]!.replaceAll('&amp;', '&'))
        .filter(href => href.startsWith('/') && !href.startsWith('//'));
      assert.ok(hrefs.length > 3, `${page} has links`);
      for (const href of hrefs) {
        const path = href.split('#')[0]!;
        if (!path || checked.has(path) || path.startsWith('/landing-assets/') || path === '/favicon.svg') continue;
        checked.add(path);
        // The Google button on /signup is the one intended entry to OAuth.
        if (path === '/auth/google') { assert.ok(page.startsWith('/signup'), `${page} links straight to OAuth`); continue; }
        const response = await app.request(path);
        const location = response.headers.get('location') ?? '';
        assert.doesNotMatch(location, /\/auth\//, `${page} → ${path} redirects to sign-in`);
      }
    }
    assert.ok(checked.has('/signup'));
    // The check would catch a sign-in-only destination such as /matches.
    assert.match((await app.request('/matches')).headers.get('location') ?? '', /\/auth\//);
    assert.equal(checked.has('/matches'), false);
  } finally {
    registry.close();
  }
});
