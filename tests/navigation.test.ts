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
  return [...nav.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)].map((match) => ({
    href: match[1]!.replaceAll('&amp;', '&'),
    active: match[2]!.includes('aria-current="page"'),
    label: match[3]!,
  }));
}

test('primary navigation has one anonymous and one signed-in contract in both languages', () => {
  assert.deepEqual(primaryNav('zh', {
    active: 'signup', exampleHref: '/demo', languageHref: '/signup?lang=en',
  }), [
    { label: '註冊／登入', href: '/signup', active: true },
    { label: '範例儀表板', href: '/demo', active: false },
    { label: 'EN', href: '/signup?lang=en' },
  ]);
  assert.deepEqual(primaryNav('en', {
    active: 'matches', dashboardHref: '/alex', languageHref: '/matches?lang=zh',
  }), [
    { label: 'Dashboard', href: '/alex', active: false },
    { label: 'Channels', href: '/channel/', active: false },
    { label: 'Matches', href: '/matches', active: true },
    { label: 'Account', href: '/account', active: false },
    { label: '中文', href: '/matches?lang=zh' },
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
      [`/${DEFAULT_HANDLE}?range=90d&lang=zh`, '範例儀表板', `/${DEFAULT_HANDLE}?range=90d&lang=en`],
    ] as const;
    for (const [path, active, languageHref] of cases) {
      const response = await app.request(path);
      assert.ok(response.status === 200, `${path} renders successfully`);
      const links = renderedNav(await response.text());
      assert.deepEqual(links.map((link) => link.label), ['註冊／登入', '範例儀表板', 'EN']);
      assert.equal(links.find((link) => link.active)?.label, active);
      assert.equal(links.at(-1)?.href, languageHref);
    }

    const signup = await (await app.request('/signup?lang=zh')).text();
    assert.match(signup, /<h1>註冊／登入<\/h1>/);
    assert.match(signup, />使用 Google 註冊／登入<\/a>/);
    assert.doesNotMatch(signup, />建立檔案館<\/a>/);

    const signupEn = await (await app.request('/signup?lang=en')).text();
    assert.match(signupEn, /<h1>Sign up \/ sign in<\/h1>/);
    assert.match(signupEn, />Sign up \/ sign in with Google<\/a>/);
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
      ['/account?lang=zh', '帳號', '/account?lang=en'],
      ['/onboarding?lang=zh', undefined, '/onboarding?lang=en'],
      ['/extension-setup?lang=zh', '帳號', '/extension-setup?lang=en'],
      ['/account/taxonomy?lang=zh', '帳號', '/account/taxonomy?lang=en'],
    ] as const;
    for (const [path, active, languageHref] of cases) {
      const response = await app.request(path, { headers: { cookie } });
      assert.ok(response.status === 200 || response.status === 403, `${path} renders a complete page`);
      const links = renderedNav(await response.text());
      assert.deepEqual(links.map((link) => link.label), ['儀表板', '頻道', '配對', '帳號', 'EN']);
      assert.equal(links.find((link) => link.active)?.label, active);
      assert.equal(links.at(-1)?.href, languageHref);
    }
  } finally {
    registry.close();
  }
});

test('shared shell keeps the full menu usable at phone widths', () => {
  const page = shell('Navigation test', '', primaryNav('en', { dashboardHref: '/alex' }));
  assert.match(page, /@media\(max-width:760px\)\{\.site-header\{align-items:flex-start;flex-direction:column/);
  assert.match(page, /\.site-nav\{display:flex;gap:4px;max-width:100%;overflow-x:auto/);
  assert.match(page, /aria-label="Primary navigation"/);
});
