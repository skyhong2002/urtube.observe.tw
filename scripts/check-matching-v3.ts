// Isolated UI test. Requires /tmp/browser playwright + /usr/bin/chromium.
// Run with NODE_ENV=test and the same test env as npm test; no real API/DB.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { serve } from '@hono/node-server';
import { UserRegistry } from '../src/users.js';
import { createApp } from '../src/index.js';
import { settings } from '../src/matching-v3/model.js';
import { runCycle } from '../src/matching-v3/pipeline.js';
import type { Provider } from '../src/matching-v3/provider.js';
import type { Compute } from '../src/matching-v3/compute.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';

if (process.env.NODE_ENV !== 'test' || process.env.DATABASE_PATH !== ':memory:') throw new Error('Use isolated test environment');
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? '/tmp/browser/package.json');
const { chromium } = require('playwright');
const s = { ...settings(), enabled: true };
const registry = new UserRegistry(':memory:');
const genres = ['Politic', 'Music', 'Sport', 'Education', 'Video gaming', 'Streaming', 'News', 'Podcast', 'channel type'] as const;
for (const name of ['browserleft', 'browserright']) {
  registry.createUser(name, name); registry.setMatchingOptIn(name, true);
  const user = registry.userByHandle(name)!;
  for (let i = 0; i < 5; i++) registry.repositoryFor(user).upsertYoutubeCapture(normalizeYoutubeCapture({
    sessionId: `${name}-fixture-session-${i}`, videoId: `V3BROWSER0${i}`, title: '羽球 #羽球', url: `https://www.youtube.com/watch?v=V3BROWSER0${i}`,
    watchedAt: '2026-09-04T12:00:00Z', actualWatchedSeconds: 30, durationSeconds: 60,
  }, new Date('2026-09-05T12:00:00Z')));
  if (name === 'browserright') registry.matchingV3Store().savePreferences(user.id, { genres: [...genres], topics: [] });
}
const provider: Provider = { classify: async () => ({ tagSource: 'original', tags: ['羽球'], assignments: [{ genre: 'Sport', tags: ['羽球'] }] }),
  embed: async tags => tags.map(() => [1, 0]), channel: async () => ({ types: [], evidenceAvailable: false }) };
const compute: Compute = { cluster: async points => ({ totalMass: 5, retainedCoverage: 1,
  clusters: [{ centroid: [1, 0], mass: 5, share: 1, tags: points.map(p => ({ text: p.text, count: p.count, generatedCount: p.generatedCount })) }] }),
  compare: async (a, b) => ({ score: a.clusters.length && b.clusters.length ? 1 : 0,
    transport: a.clusters.length && b.clusters.length ? [{ left: 0, right: 0, mass: 1, similarity: 1, contribution: 1 }] : [] }) };
const app = createApp(registry, { matchingV3: { settings: s, compute } });
registry.setDashboardPublic('browserright', true);
const server = serve({ fetch: app.fetch, port: 3000 });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addCookies([{ name: 'urtube_session', value: registry.createSession(registry.userByHandle('browserleft')!), domain: 'localhost', path: '/' }]);
const page = await context.newPage(), errors: string[] = [];
page.on('pageerror', (error: Error) => errors.push(error.message));
try {
  await page.goto('http://localhost:3000/matching-v3?lang=zh');
  assert.ok(page.url().includes('/matches?'));
  await page.locator('#mv-all').click();
  assert.equal(await page.locator('#mv-directory .mt-card').count(), 1);
  assert.equal(await page.locator('#mv-directory .mt-percent').count(), 1);
  const friendshipIcon = page.locator('#mv-directory .mt-card [data-friendship-tools] button');
  assert.equal(await friendshipIcon.count(), 1);
  assert.ok(await friendshipIcon.getAttribute('aria-label'));
  assert.ok(await friendshipIcon.getAttribute('title'));
  assert.equal(await friendshipIcon.locator('svg').count(), 1);
  const addIconBox = await friendshipIcon.locator('svg').boundingBox();
  assert.ok(addIconBox && addIconBox.width >= 16 && addIconBox.height >= 16, 'add-friend SVG must remain visibly sized');
  assert.equal(await page.locator('#mv-directory .mt-card .mt-actions button').count(), 0);
  await page.locator('#interests').click();
  for (const genre of genres) await page.getByRole('checkbox', { name: genre, exact: true }).check();
  await page.getByRole('button', { name: '儲存', exact: true }).click();
  await page.locator('#editor').waitFor({ state: 'hidden' });
  await runCycle(registry, s, provider, compute);
  await page.reload();
  await page.locator('#add').click();
  await page.getByLabel('主題名稱').fill('九類一起探索');
  for (const genre of genres) await page.getByRole('checkbox', { name: genre, exact: true }).check();
  await page.getByRole('button', { name: '儲存', exact: true }).click();
  const [publicResponse] = await Promise.all([
    page.waitForResponse((response: { url(): string }) => new URL(response.url()).pathname === '/api/matching-v3/match'),
    page.getByRole('button', { name: '開始配對' }).click(),
  ]);
  assert.equal(publicResponse.status(), 200);
  const publicMatch = await publicResponse.json();
  assert.equal(publicMatch.candidates.length, 1);
  assert.equal(publicMatch.candidates[0].detailsVisible, true);
  assert.match(JSON.stringify(publicMatch.candidates[0].reasons), /羽球/);
  assert.doesNotMatch(JSON.stringify(publicMatch), /"centroid"|V3BROWSER/);
  await page.locator('#detail .mt-card').waitFor();
  assert.equal(await page.locator('#detail .mv-reasons,#detail .mv-topic-score,#detail .mt-percent').count(), 0);
  assert.equal(await page.locator('#detail .mt-person-link').count(), 1);
  assert.equal(await page.locator('#detail .mt-actions a').count(), 1);
  assert.equal(await page.locator('.chips .chip').count(), 9);
  await page.screenshot({ path: '/tmp/urtube-pr61-desktop.png', fullPage: true });
  await page.reload();
  await page.getByRole('heading', { name: '九類一起探索', exact: true }).waitFor();
  await page.getByRole('button', { name: '編輯', exact: true }).click();
  for (const genre of genres) await page.getByRole('checkbox', { name: genre, exact: true }).uncheck();
  await page.getByRole('button', { name: '儲存', exact: true }).click();
  assert.match(await page.locator('#form-error').innerText(), /至少/);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  registry.setDashboardPublic('browserright', false);
  const [privateResponse] = await Promise.all([
    page.waitForResponse((response: { url(): string }) => new URL(response.url()).pathname === '/api/matching-v3/match'),
    page.getByRole('button', { name: '開始配對' }).click(),
  ]);
  assert.equal(privateResponse.status(), 200);
  const privateMatch = await privateResponse.json();
  assert.equal(privateMatch.candidates.length, 1);
  assert.equal(privateMatch.candidates[0].detailsVisible, false);
  assert.deepEqual(privateMatch.candidates[0].reasons, []);
  assert.deepEqual(privateMatch.candidates[0].details, []);
  assert.doesNotMatch(JSON.stringify(privateMatch), /羽球|"centroid"|V3BROWSER/);
  await page.locator('#detail .mt-card').waitFor();
  assert.equal(await page.locator('#detail .mv-reasons,#detail .mv-topic-score,#detail .mt-percent,#detail .mt-actions a').count(), 0);
  assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  await page.screenshot({ path: '/tmp/urtube-pr61-mobile.png', fullPage: true });
  registry.setDashboardPublic('browserright', true);
  const sender = registry.userByHandle('browserright')!, recipient = registry.userByHandle('browserleft')!;
  registry.createMatchRequest(sender, registry.issueMatchActionToken(sender, recipient.id, []));
  await page.goto('http://localhost:3000/matches?view=invites&lang=zh');
  await page.locator('#mv-invitations button[value=accept]').waitFor();
  await page.locator('#mv-invitations button[value=accept]').click();
  await page.waitForURL('**/matches');
  assert.equal(registry.matchingRelationshipFor(recipient, sender.id).status, 'connected');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('http://localhost:3000/matches?view=all&lang=zh');
    const tools = page.locator('#mv-directory .mt-card [data-friendship-tools]');
    const withdraw = tools.locator('form[action="/matches/withdraw"] button');
    assert.equal(await withdraw.count(), 1);
    assert.ok(await withdraw.getAttribute('aria-label'));
    assert.ok(await withdraw.getAttribute('title'));
    assert.equal(await withdraw.locator('svg').count(), 1);
    const removeIconBox = await withdraw.locator('svg').boundingBox();
    assert.ok(removeIconBox && removeIconBox.width >= 16 && removeIconBox.height >= 16, 'remove-friend SVG must remain visibly sized');
    assert.equal(await page.locator('#mv-directory .mt-card .mt-actions button').count(), 0);
    const cardBox = await page.locator('#mv-directory .mt-card').boundingBox();
    const toolsBox = await tools.boundingBox();
    assert.ok(cardBox && toolsBox && toolsBox.x > cardBox.x + cardBox.width / 2 && toolsBox.y < cardBox.y + cardBox.height / 2,
      'friendship controls sit in the upper-right corner of the member card');
    assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
    await page.screenshot({ path: `/tmp/urtube-friendship-directory-${width}.png`, fullPage: true });
  }
  const [withdrawResponse] = await Promise.all([
    page.waitForResponse((response: { url(): string; request(): { method(): string } }) =>
      new URL(response.url()).pathname === '/matches/withdraw' && response.request().method() === 'POST'),
    page.locator('#mv-directory [data-friendship-tools] form[action="/matches/withdraw"] button').click(),
  ]);
  assert.equal(withdrawResponse.status(), 302);
  assert.equal(registry.matchingRelationshipFor(recipient, sender.id).status, 'none');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('http://localhost:3000/browserleft?lang=zh');
    assert.equal(await page.locator('[data-v3-interests] .yt-v3-genre').count(), 9);
    assert.equal(await page.locator('.yt-stable-topics,[data-rank-race="topics"],[data-topic-trend]').count(), 0);
    assert.equal(await page.locator('[data-rank-race="channels"]').count(), 1);
    assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
    await page.screenshot({ path: `/tmp/urtube-v3-dashboard-${width}.png`, fullPage: true });
    await page.goto('http://localhost:3000/browserleft/insights?lang=zh');
    assert.equal(await page.locator('[data-v3-interests] .yt-v3-genre').count(), 9);
    assert.equal(await page.locator('.yt-keywords').count(), 0);
    await page.goto('http://localhost:3000/account/taxonomy?lang=zh');
    assert.ok(page.url().endsWith('/account?lang=zh#processing'));
    assert.equal(await page.locator('#processing [data-v3-processing]').count(), 1);
    assert.doesNotMatch(await page.locator('#processing').innerText(), /預計還需|120 分鐘|AI 主題/);
    assert.equal(await page.locator('a[href="/account/taxonomy"]').count(), 0);
    assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
    await page.screenshot({ path: `/tmp/urtube-v3-progress-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('Matching v3 browser checks passed: nine genres, persistence, API reason privacy, compact topic cards, friendship icons and removal, minimum selection, v3 dashboard/progress, taxonomy redirect, mobile layout.');
} finally { await browser.close(); server.close(); registry.close(); }
