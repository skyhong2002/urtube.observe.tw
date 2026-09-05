import assert from 'node:assert/strict';
import { load } from 'cheerio';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import { settings, version, type Profile } from '../src/matching-v3/model.js';
import type { Compute } from '../src/matching-v3/compute.js';

const config = settings({ MATCHING_V3_ENABLED: 'true', MATCHING_V3_ADMIN_HANDLES: 'integrate-alice' });
const compute: Compute = {
  cluster: async () => { throw new Error('Classification must not run from the UI'); },
  compare: async () => ({ score: .65, transport: [{ left: 0, right: 0, contribution: .65, mass: 1, similarity: .65 }] }),
};
function publish(registry: UserRegistry, user: User) {
  const store = registry.matchingV3Store();
  const profile: Profile = {
    version: version(config), sourceFingerprint: 'fixture', builtAt: '2026-09-06T00:00:00Z', complete: true,
    processedVideos: 20, totalVideos: 20,
    genres: { Music: { status: 'ready', retainedCoverage: 1, totalMass: 20, videoCount: 20,
      clusters: [{ centroid: [1, 0], mass: 20, share: 1, tags: [{ text: 'private-detail-tag', count: 20, generatedCount: 0 }] }] } },
  };
  store.savePreferences(user.id, { genres: ['Music'], topics: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Music time', genres: ['Music'] }] });
  store.schedule(user.id, 'fixture', version(config)); store.finish(store.claim()!, profile);
}
function setup(customCompute = compute) {
  const registry = new UserRegistry(':memory:');
  const alice = registry.createUser('integrate-alice', 'Alice');
  const bob = registry.createUser('integrate-bob', 'Bob <script>');
  publish(registry, alice); publish(registry, bob);
  const session = registry.createSession(alice), bobSession = registry.createSession(bob);
  const headers = { cookie: `urtube_session=${session}`, origin: 'http://localhost:3000', 'content-type': 'application/json' };
  const app = createApp(registry, { matchingV3: { settings: config, compute: customCompute } });
  const match = () => app.request('/api/matching-v3/match?lang=zh', { method: 'POST', headers, body: JSON.stringify({ genres: ['Music'] }) });
  return { registry, alice, bob, session, bobSession, headers, app, match };
}

test('one matching workspace keeps directory actions and compact topic cards with permitted Blend access', async () => {
  const f = setup();
  try {
    const { registry, alice, bob, headers, app } = f;
    assert.equal(registry.matchingCrystalFor(bob.handle), null, 'v3-only member has no legacy matching profile');
    const directoryResponse = await app.request('/matches?lang=zh', { headers });
    assert.equal(directoryResponse.status, 200);
    const directory = load(await directoryResponse.text());
    assert.equal(directory('#mv-all,#mv-invites,#topics').length, 3);
    assert.equal(directory('#mv-directory .mt-card').length, 1);
    assert.equal(directory('#mv-directory .mt-percent').text(), '—合拍度');
    assert.equal(directory('#mv-directory form[action="/matches/request"]').length, 1);
    assert.equal(directory('a[href="/matching-v3/admin"]').length, 0);
    assert.match(directory('#mv-invitations').text(), /目前沒有/);
    const alias = await app.request('/matching-v3?lang=zh', { headers });
    assert.equal(alias.status, 302);
    assert.equal(alias.headers.get('location'), '/matches?lang=zh&view=topics');
    const body = await (await f.match()).json() as any;
    const candidate = body.candidates[0];
    assert.equal(candidate.handle, bob.handle);
    assert.equal(candidate.score, .65);
    assert.equal(candidate.detailsVisible, false);
    assert.deepEqual(candidate.reasons, []); assert.deepEqual(candidate.details, []);
    assert.ok(!JSON.stringify(body).includes('private-detail-tag'));
    const card = load(candidate.memberHtml);
    assert.equal(card('.mt-person-link').attr('href'), '/integrate-bob');
    assert.equal(card('h2').text(), bob.displayName);
    assert.equal(card('script').length, 0);
    assert.equal(card('.mv-topic-score, .mv-reasons, .mt-percent, .mt-icebreaker').length, 0);
    assert.equal(card('.mt-card').attr('data-compatibility'), '-1');
    assert.equal(card('.mt-actions a[href*="/compare/"]').length, 0);
    const refreshedDirectory = load(await (await app.request('/matches?lang=zh', { headers })).text());
    const actionToken = refreshedDirectory('#mv-directory [name=actionToken]').attr('value')!;
    const send = await app.request('/matches/request', { method: 'POST', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ actionToken, returnTo: '/matches' }) });
    assert.equal(send.status, 302);
    assert.equal(send.headers.get('location'), '/matches');
    registry.setDashboardPublic(alice.handle, true);
    const bobHeaders = { cookie: `urtube_session=${f.bobSession}` };
    const inbox = load(await (await app.request('/matches?view=invites&lang=zh', { headers: bobHeaders })).text());
    assert.equal(inbox('#mv-invitations form[action="/matches/respond"]').length, 1, 'public senders stay actionable');
    const requestToken = inbox('#mv-invitations [name=requestToken]').attr('value')!;
    const accept = await app.request('/matches/respond', { method: 'POST', headers: { ...bobHeaders, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ requestToken, response: 'accept', returnTo: '/matches' }) });
    assert.equal(accept.status, 302);
    const friends = await (await f.match()).json() as any;
    assert.equal(friends.candidates[0].detailsVisible, true);
    assert.match(friends.candidates[0].reasons[0].text, /private-detail-tag/);
    const friendCard = load(friends.candidates[0].memberHtml);
    assert.equal(friendCard('.mt-actions a').attr('href'), '/integrate-alice/compare/integrate-bob');
    assert.equal(friendCard('.mv-reasons, .mt-percent, .mv-topic-score').length, 0);
    for (const path of ['/integrate-bob','/integrate-bob/insights','/integrate-alice/compare/integrate-bob']) assert.equal((await app.request(path,{headers})).status,200,path);
    for (const path of ['/integrate-bob/history','/integrate-bob/recap']) assert.equal((await app.request(path,{headers})).status,404,path);
    registry.withdrawMatchRequest(alice, requestToken);
    assert.equal((await (await f.match()).json() as any).candidates[0].detailsVisible, false);
    registry.setDashboardPublic(bob.handle, true);
    const publicCandidate = (await (await f.match()).json() as any).candidates[0];
    assert.equal(publicCandidate.detailsVisible, true);
    assert.equal(load(publicCandidate.memberHtml)('.mt-actions a').attr('href'), '/integrate-alice/compare/integrate-bob');
    registry.setDashboardPublic(bob.handle, false);
    assert.equal((await (await f.match()).json() as any).candidates[0].detailsVisible, false);
    registry.setMatchingOptIn(bob.handle, false);
    assert.equal((await (await f.match()).json() as any).candidates.length, 0);
  } finally { f.registry.close(); }
});

test('v3 pending data does not block the directory or direct public Blend', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const alice = registry.createUser('pending-alice', 'Alice'), bob = registry.createUser('pending-public', 'Bob');
    registry.setDashboardPublic(bob.handle, true); registry.setMatchingOptIn(bob.handle, false);
    const app = createApp(registry, { matchingV3: { settings: config, compute } });
    const headers = { cookie: `urtube_session=${registry.createSession(alice)}` };
    const $ = load(await (await app.request('/matches', { headers })).text());
    assert.equal($('#mv-directory .mt-person-link').attr('href'), '/pending-public');
    assert.equal($('#mv-directory .mt-actions a').attr('href'), '/pending-alice/compare/pending-public');
    assert.equal((await app.request('/pending-alice/compare/pending-public', { headers })).status, 200);
    assert.equal((await app.request('/api/matching-v3/match', { method: 'POST', headers: { ...headers, origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ genres: ['Music'] }) })).status,403);
  } finally {registry.close()}
});

for (const revoke of ['session', 'friendship', 'public', 'genre', 'optout'] as const) {
  test(`v3 rechecks ${revoke} after asynchronous compute`, async () => {
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const f = setup({ ...compute, compare: async (a,b) => { entered(); await gate; return compute.compare(a,b); } });
    try {
      const { registry, alice, bob } = f;
      registry.createMatchRequest(alice, registry.issueMatchActionToken(alice,bob.id,[]));
      const request = registry.matchingInboxFor(bob).incoming[0]!;
      registry.respondToMatchRequest(bob,request.requestToken,'accept');
      if(revoke==='public'){registry.withdrawMatchRequest(alice,request.requestToken);registry.setDashboardPublic(bob.handle,true)}
      const pending=f.match(); await started;
      if(revoke==='session')registry.deleteSession(f.session);
      if(revoke==='friendship')registry.withdrawMatchRequest(alice,request.requestToken);
      if(revoke==='public')registry.setDashboardPublic(bob.handle,false);
      if(revoke==='genre')registry.matchingV3Store().savePreferences(bob.id,{genres:[],topics:[]});
      if(revoke==='optout')registry.setMatchingOptIn(bob.handle,false);
      release();const response=await pending;
      if(revoke==='session'){assert.equal(response.status,401);return}
      assert.equal(response.status,200);
      const data=await response.json() as any;
      if(revoke==='genre'||revoke==='optout')assert.equal(data.candidates.length,0);
      else {assert.equal(data.candidates[0].detailsVisible,false);assert.ok(!JSON.stringify(data).includes('private-detail-tag'))}
    } finally {f.registry.close()}
  });
}


test('Blend uses the v3 score below old activity thresholds and explains unavailable consent', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const alice = registry.createUser('v3-blend-a', 'A', { dashboardPublic:true });
    const bob = registry.createUser('v3-blend-b', 'B', { dashboardPublic:true });
    registry.setMatchingOptIn(alice.handle,true); registry.setMatchingOptIn(bob.handle,true);
    publish(registry,alice); publish(registry,bob);
    const app = createApp(registry,{matchingV3:{settings:config,compute}});
    const headers = {cookie:`urtube_session=${registry.createSession(alice)}`};
    const matches = await (await app.request('/api/matching-v3/match', {method:'POST',headers:{...headers,origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify({genres:['Music']})})).json() as {candidates:Array<{score:number}>};
    for (const range of ['28d','all']) {
      const $ = load(await (await app.request(`/v3-blend-a/compare/v3-blend-b?range=${range}&lang=zh`,{headers})).text());
      assert.equal($('.mt-vs-score strong').text(), `${Math.round(matches.candidates[0].score*100)}%`);
      assert.match($('.mt-panel').text(), /v3 興趣分析/);
      assert.doesNotMatch($('.mt-panel').text(), /cosine|0.4–0.95/);
    }
    registry.matchingV3Store().savePreferences(alice.id,{genres:['Music','Sport'],topics:[]});
    registry.matchingV3Store().savePreferences(bob.id,{genres:['Music','Sport'],topics:[]});
    const missing = load(await (await app.request('/v3-blend-a/compare/v3-blend-b?lang=zh',{headers})).text());
    assert.equal(missing('.mt-vs-score strong').text(),'—');
    assert.match(missing('form').text(),/尚無可比較結果：運動/);
    assert.match(missing('.mt-vs-score').text(),/運動尚無可比較結果/);
    const usableLink = missing('.mt-vs-score a').attr('href')!;
    assert.match(usableLink,/genre=Music/);
    assert.doesNotMatch(usableLink,/Sport/);
    const quick = load(await (await app.request('/v3-blend-a/compare/v3-blend-b'+usableLink,{headers})).text());
    assert.equal(quick('.mt-vs-score strong').text(),'65%');
    assert.match(quick('.mt-vs-score').text(),/本次選取 1 類/);
    const selected = load(await (await app.request('/v3-blend-a/compare/v3-blend-b?lang=zh&genre=Music',{headers})).text());
    assert.equal(selected('.mt-vs-score strong').text(),'65%');
    assert.match(selected('.mt-range a').first().attr('href')!,/genre=Music/);
    registry.setMatchingOptIn(bob.handle,false);
    const $ = load(await (await app.request('/v3-blend-a/compare/v3-blend-b?lang=zh',{headers})).text());
    assert.equal($('.mt-vs-score strong').text(),'—');
    assert.match($('.mt-vs-score').text(),/尚無雙方共同開放/);
  } finally {registry.close();}
});

test('Blend rechecks visibility after asynchronous v3 scoring', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const alice = registry.createUser('v3-race-a','A',{dashboardPublic:true});
    const bob = registry.createUser('v3-race-b','B',{dashboardPublic:true});
    registry.setMatchingOptIn(alice.handle,true);registry.setMatchingOptIn(bob.handle,true);
    publish(registry,alice);publish(registry,bob);
    const app = createApp(registry,{matchingV3:{settings:config,compute:{...compute,compare:async(a,b)=>{
      registry.setDashboardPublic(bob.handle,false);return compute.compare(a,b);
    }}}});
    const response = await app.request('/v3-race-a/compare/v3-race-b',{headers:{cookie:`urtube_session=${registry.createSession(alice)}`}});
    assert.equal(response.status,404);
    assert.doesNotMatch(await response.text(),/65%|private-detail-tag/);
  } finally {registry.close();}
});
