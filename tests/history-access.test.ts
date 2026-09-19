import assert from 'node:assert/strict';
import { load } from 'cheerio';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { encryptPrivateValue } from '../src/youtube/crypto.js';

const PRIVATE_QUERY = 'private-search-only-synthetic-sentinel';
const HOSTILE_TITLE = '<img src=x onerror=alert(1)> %_\\';

function fixture() {
  const registry = new UserRegistry(':memory:');
  const owner = registry.createUser('history-owner', 'History Owner');
  const friend = registry.createUser('history-friend', 'History Friend');
  const outsider = registry.createUser('history-outsider', 'History Outsider');
  registry.setMatchingPreferences(owner.handle, true, 'topics_and_channel');
  registry.setMatchingPreferences(friend.handle, true, 'topics_and_channel');
  registry.createMatchRequest(friend, registry.issueMatchActionToken(friend, owner.id, ['Music']));
  registry.respondToMatchRequest(owner, registry.matchingInboxFor(owner).incoming[0]!.requestToken, 'accept');
  const now = Date.now();
  const ciphertext = encryptPrivateValue(PRIVATE_QUERY, 'history-access-synthetic-encryption-key-only');
  registry.repositoryFor(owner).ingestYoutubeArchive({
    archiveHash: 'history-access-fixture', source: 'takeout',
    watches: Array.from({ length: 62 }, (_, i) => ({
      eventId: `history-event-${i}`, videoId: `HIS${String(i).padStart(8, '0')}`,
      title: i === 60 ? HOSTILE_TITLE : i === 61 ? 'Older than one year fixture' : `History fixture ${i}`,
      url: `https://www.youtube.com/watch?v=HIS${String(i).padStart(8, '0')}`,
      channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', channelTitle: 'Synthetic history channel', channelUrl: null,
      watchedAt: new Date(now - (i === 61 ? 400 * 86400_000 : i * 60_000)).toISOString(),
      actualWatchedSeconds: null, durationSeconds: 90, activityType: 'video' as const,
    })),
    searches: [{ eventId: 'private-search', searchedAt: new Date(now - 30_000).toISOString(), queryCiphertext: ciphertext, activityType: 'search' }],
  });
  const session = registry.createSession(owner);
  return {
    registry, owner, friend, outsider, ciphertext, session,
    ownerHeaders: { cookie: `urtube_session=${session}` },
    friendHeaders: { cookie: `urtube_session=${registry.createSession(friend)}` },
    outsiderHeaders: { cookie: `urtube_session=${registry.createSession(outsider)}` },
    app: createApp(registry),
  };
}

function privateResponse(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('x-robots-tag') ?? '', /\bnoindex\b/);
}

function dashboardCookie(response: Response): string {
  const value = response.headers.getSetCookie().find(cookie => cookie.startsWith('urtube_dash_id_'));
  assert.ok(value, 'an authorized key is exchanged for the stable account cookie');
  assert.match(value, /; HttpOnly/i);
  assert.match(value, /; SameSite=Lax/i);
  return value.split(';')[0];
}

function assertNoCredentials(markup: string, key: string) {
  const $ = load(markup);
  assert.ok(!markup.includes(key), 'the private dashboard key must not be rendered');
  assert.equal($('input[name="key"]').length, 0);
  for (const element of $('a[href], form[action]').toArray()) {
    const address = $(element).attr('href') ?? $(element).attr('action')!;
    assert.equal(new URL(address, 'http://localhost:3000').searchParams.has('key'), false);
  }
}

test('History checks access before validating filters, even for public profiles and friends', async () => {
  const f = fixture();
  try {
    const invalid = new URLSearchParams({ q: '😀'.repeat(121), from: '2026-02-30', cursor: 'invalid-cursor' });
    for (const dashboardPublic of [false, true]) {
      f.registry.setDashboardPublic(f.owner.handle, dashboardPublic);
      for (const headers of [undefined, f.friendHeaders, f.outsiderHeaders]) {
        for (const suffix of ['', `?${invalid}`]) {
          const response = await f.app.request(`/history-owner/history${suffix}`, { headers });
          assert.equal(response.status, 404);
          privateResponse(response);
          const markup = await response.text();
          assert.ok(!markup.includes('History fixture'));
          assert.ok(!markup.includes(PRIVATE_QUERY));
          assert.equal(load(markup)('input[name="q"]').length, 0, 'unauthorized callers do not receive the search form');
        }
      }
    }
    const unknown = await f.app.request(`/missing-history-user/history?${invalid}`, { headers: f.ownerHeaders });
    assert.equal(unknown.status, 404);
    privateResponse(unknown);
    const owner = await f.app.request('/history-owner/history', { headers: f.ownerHeaders });
    assert.equal(owner.status, 200);
    privateResponse(owner);
    const $ = load(await owner.text());
    assert.equal($('.hs-rows > li').length, 50, 'the default page is bounded to 50 events');
    assert.equal($('input[name="range"]').attr('value'), '365d');
    assert.ok(!$.html().includes('Older than one year fixture'));
  } finally { f.registry.close(); }
});

test('History reports invalid input with a private, usable form and accepts 120 Unicode characters', async () => {
  const f = fixture();
  try {
    const invalidQueries: Array<Record<string, string>> = [
      { q: '😀'.repeat(121) },
      { from: '2026-02-30' },
      { to: 'not-a-date' },
      { from: '2026-09-20', to: '2026-09-19' },
      { cursor: '%%%not-base64%%%' },
      { cursor: Buffer.from('{"timestamp":false}').toString('base64url') },
      { cursor: 'x'.repeat(5000) },
    ];
    for (const values of invalidQueries) {
      const query = new URLSearchParams({ ...values, lang: 'zh' });
      const response = await f.app.request(`/history-owner/history?${query}`, { headers: f.ownerHeaders });
      assert.equal(response.status, 400, JSON.stringify(values));
      privateResponse(response);
      assert.match(response.headers.get('content-type') ?? '', /text\/html/);
      const markup = await response.text(), $ = load(markup);
      assert.equal($('input[name="q"]').length, 1);
      assert.equal($('input[name="from"]').length, 1);
      assert.equal($('input[name="to"]').length, 1);
      assert.equal($('input[name="q"]').closest('form').attr('method')?.toLowerCase(), 'get');
      assert.ok($('[role="alert"]').text().trim().length > 0, 'the error is visible and announced');
      assert.ok(!markup.includes('History fixture'));
      assertNoCredentials(markup, f.owner.dashboardToken);
    }
    const q = '😀'.repeat(120);
    const accepted = await f.app.request(`/history-owner/history?${new URLSearchParams({ q })}`, { headers: f.ownerHeaders });
    assert.equal(accepted.status, 200);
    assert.equal(load(await accepted.text())('input[name="q"]').attr('value'), q);
  } finally { f.registry.close(); }
});

test('History exchanges a key for a cookie, preserves its pagination filters, and strips other parameters', async () => {
  const f = fixture();
  try {
    const parameters = new URLSearchParams({ q: 'History fixture', from: '2020-01-01', to: '2099-12-31', range: 'all', lang: 'zh' });
    const first = await f.app.request(`/history-owner/history?${parameters}`, { headers: f.ownerHeaders });
    assert.equal(first.status, 200);
    const $ = load(await first.text());
    const nextHref = $('a[href]').toArray().map(element => $(element).attr('href')!)
      .find(href => new URL(href, 'http://localhost:3000').searchParams.has('cursor'));
    assert.ok(nextHref, 'more than 50 matching watches have a continuation link');
    const nextUrl = new URL(nextHref, 'http://localhost:3000');
    const expected = new URLSearchParams(nextUrl.search);
    nextUrl.searchParams.set('key', f.owner.dashboardToken);
    nextUrl.searchParams.set('unrecognized', 'do-not-copy');
    nextUrl.searchParams.set('sort', 'watches');
    const redirected = await f.app.request(`${nextUrl.pathname}${nextUrl.search}`);
    assert.equal(redirected.status, 302);
    privateResponse(redirected);
    const destination = new URL(redirected.headers.get('location')!, 'http://localhost:3000');
    assert.equal(destination.pathname, '/history-owner/history');
    const allowed = new Set(['q', 'from', 'to', 'range', 'cursor', 'direction', 'lang']);
    for (const [name, value] of expected) if (allowed.has(name)) assert.equal(destination.searchParams.get(name), value, name);
    for (const name of destination.searchParams.keys()) assert.ok(allowed.has(name), name);
    assert.equal(destination.searchParams.has('key'), false);
    const continued = await f.app.request(`${destination.pathname}${destination.search}`, { headers: { cookie: dashboardCookie(redirected) } });
    assert.equal(continued.status, 200);
    privateResponse(continued);
    const markup = await continued.text();
    assert.equal(load(markup)('.hs-rows > li').length, 10);
    assertNoCredentials(markup, f.owner.dashboardToken);
  } finally { f.registry.close(); }
});

test('History rejects revoked key cookies and sessions on every read', async () => {
  const f = fixture();
  try {
    f.registry.setDashboardPublic(f.owner.handle, true);
    const redirect = await f.app.request(`/history-owner/history?key=${f.owner.dashboardToken}&range=all`);
    assert.equal(redirect.status, 302);
    const cookie = dashboardCookie(redirect);
    const destination = redirect.headers.get('location')!;
    assert.equal((await f.app.request(destination, { headers: { cookie } })).status, 200);
    f.registry.rotateTokens(f.owner.handle);
    const revokedKey = await f.app.request(destination, { headers: { cookie } });
    assert.equal(revokedKey.status, 404);
    privateResponse(revokedKey);
    assert.equal((await f.app.request(destination, { headers: f.ownerHeaders })).status, 200);
    f.registry.deleteSession(f.session);
    const revokedSession = await f.app.request(destination, { headers: f.ownerHeaders });
    assert.equal(revokedSession.status, 404);
    privateResponse(revokedSession);
  } finally { f.registry.close(); }
});

test('History preserves authorized handle-alias redirects without exposing the key', async () => {
  const f = fixture();
  try {
    f.registry.renameUser(f.owner.handle, 'history-renamed');
    const parameters = new URLSearchParams({ q: 'History fixture', range: 'all', from: '2020-01-01', to: '2099-12-31', lang: 'zh', key: f.owner.dashboardToken });
    const redirected = await f.app.request(`/history-owner/history?${parameters}`);
    assert.equal(redirected.status, 302);
    privateResponse(redirected);
    const destination = new URL(redirected.headers.get('location')!, 'http://localhost:3000');
    assert.equal(destination.pathname, '/history-renamed/history');
    assert.equal(destination.searchParams.has('key'), false);
    for (const name of ['q', 'range', 'from', 'to', 'lang']) assert.equal(destination.searchParams.get(name), parameters.get(name));
    const response = await f.app.request(`${destination.pathname}${destination.search}`, { headers: { cookie: dashboardCookie(redirected) } });
    assert.equal(response.status, 200);
    assertNoCredentials(await response.text(), f.owner.dashboardToken);
  } finally { f.registry.close(); }
});

test('History escapes literal search input and stored titles without revealing YouTube searches', async () => {
  const f = fixture();
  try {
    const parameters = new URLSearchParams({ q: HOSTILE_TITLE, range: 'all' });
    const response = await f.app.request(`/history-owner/history?${parameters}`, { headers: f.ownerHeaders });
    assert.equal(response.status, 200);
    privateResponse(response);
    const markup = await response.text(), $ = load(markup);
    assert.equal($('input[name="q"]').attr('value'), HOSTILE_TITLE);
    assert.equal($('.hs-rows > li').length, 1);
    assert.equal($('.hs-rows strong').text(), HOSTILE_TITLE);
    assert.equal($('[onerror], [onload]').length, 0);
    assert.ok(!markup.includes(HOSTILE_TITLE), 'raw markup is escaped in both form and result');
    assert.ok(!markup.includes(PRIVATE_QUERY));
    assert.ok(!markup.includes(f.ciphertext));
    assert.ok(!markup.includes('query_ciphertext'));
    assertNoCredentials(markup, f.owner.dashboardToken);
    for (const q of ["%' OR 1=1 --", PRIVATE_QUERY]) {
      const searched = await f.app.request(`/history-owner/history?${new URLSearchParams({ q, range: 'all' })}`, { headers: f.ownerHeaders });
      assert.equal(searched.status, 200);
      const $searched = load(await searched.text());
      assert.equal($searched('input[name="q"]').attr('value'), q);
      assert.equal($searched('.hs-rows > li').length, 0, 'only literal video/channel metadata matches may appear');
    }
  } finally { f.registry.close(); }
});

test('History GET controls preserve filters and language while a new search or range drops pagination', async () => {
  const f = fixture();
  try {
    const parameters = new URLSearchParams({ q: 'History fixture', from: '2020-01-01', to: '2099-12-31', lang: 'zh' });
    const first = load(await (await f.app.request(`/history-owner/history?${parameters}`, { headers: f.ownerHeaders })).text());
    const nextHref = first('a[rel="next"]').attr('href');
    assert.ok(nextHref);
    const response = await f.app.request(nextHref, { headers: f.ownerHeaders });
    assert.equal(response.status, 200);
    const $ = load(await response.text());
    const form = $('input[name="q"]').closest('form');
    assert.equal(form.attr('method')?.toLowerCase(), 'get');
    assert.equal(form.attr('action'), '/history-owner/history');
    assert.equal(form.attr('role'), 'search');
    assert.equal(form.find('[name="cursor"], [name="direction"], [name="key"]').length, 0);
    for (const [name, value] of parameters) assert.equal(form.find(`[name="${name}"]`).attr('value'), value);
    for (const link of $('.yt-range a').toArray()) {
      const url = new URL($(link).attr('href')!, 'http://localhost:3000');
      assert.equal(url.searchParams.get('q'), 'History fixture');
      assert.equal(url.searchParams.get('lang'), 'zh');
      for (const name of ['from', 'to', 'cursor', 'direction', 'key']) assert.equal(url.searchParams.has(name), false, name);
    }
    const languageHref = $('.site-nav a[href]').toArray().map(link => $(link).attr('href')!)
      .find(href => new URL(href, 'http://localhost:3000').searchParams.get('lang') === 'en');
    assert.ok(languageHref);
    const changed = new URL(languageHref, 'http://localhost:3000');
    const current = new URL(nextHref, 'http://localhost:3000');
    for (const name of ['q', 'from', 'to', 'range', 'cursor', 'direction']) assert.equal(changed.searchParams.get(name), current.searchParams.get(name), name);
  } finally { f.registry.close(); }
});

test('History browsing does not require whole-dashboard aggregates or classification loading', async (t) => {
  const f = fixture();
  try {
    const repository = f.registry.repositoryFor(f.owner);
    t.mock.method(repository, 'youtubeDashboard', () => { throw new Error('History must not build a dashboard'); });
    t.mock.method(repository, 'youtubeCounts', () => { throw new Error('History must not count the full archive'); });
    const app = createApp(f.registry, {
      loadTagLists: async () => { throw new Error('History must not fetch classifications'); },
    });
    const response = await app.request('/history-owner/history?q=History+fixture', { headers: f.ownerHeaders });
    assert.equal(response.status, 200);
    assert.equal(load(await response.text())('.hs-rows > li').length, 50);
  } finally { f.registry.close(); }
});
