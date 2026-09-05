import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { config } from '../src/config.js';
import { createApp } from '../src/index.js';
import { createIngestApp } from '../src/ingest.js';
import {
  patchOpsStatus,
  readOpsStatus,
  writeOpsStatus,
  type WorkerOpsStatus,
} from '../src/ops-status.js';
import { UserRegistry } from '../src/users.js';
import { youtubeWorkerCycleStartedStatus } from '../src/youtube-worker.js';

// Form posts as the browser would send them after the Google step: the
// pending-signup token rides in the urtube_signup cookie.
function signupBody(
  pendingToken: string,
  fields: Record<string, string>,
  ip = '10.1.0.1',
): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `urtube_signup=${pendingToken}`,
      'x-forwarded-for': ip,
    },
    body: new URLSearchParams(fields).toString(),
  };
}

function accountTakeoutZip(): Uint8Array {
  return zipSync({
    'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify([{
      header: 'YouTube',
      title: 'Watched Account import fixture',
      titleUrl: 'https://www.youtube.com/watch?v=ACCOUNT0001',
      subtitles: [{ name: 'Account Channel', url: 'https://www.youtube.com/channel/UCaccount' }],
      time: '2026-07-28T01:00:00.000Z',
      products: ['YouTube'],
      activityControls: ['YouTube watch history'],
    }])),
  });
}

test('Google-gated signup enables discovery and public pages without exposing tokens', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    // Without a verified Google identity, /signup only offers the Google
    // button and the form post is rejected.
    assert.match(await (await app.request('/signup')).text(), /auth\/google/);
    const unauthed = await app.request('/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ handle: 'newbie', displayName: 'New User' }).toString(),
    });
    assert.equal(unauthed.status, 403);

    const pending = registry.createPendingSignup('google-sub-1', 'newbie@gmail.com');
    const form = await app.request('/signup', { headers: { cookie: `urtube_signup=${pending}` } });
    const formHtml = await form.text();
    assert.match(formHtml, /newbie@gmail\.com/);
    assert.doesNotMatch(formHtml, /name="dashboardPublic"/);

    const created = await app.request('/signup', signupBody(pending, {
      handle: 'newbie', displayName: 'New User', dashboardPublic: '1',
    }));
    assert.equal(created.status, 302);
    assert.equal(created.headers.get('location'), '/onboarding');
    assert.equal(registry.userByGoogleSub('google-sub-1')?.handle, 'newbie');
    assert.equal(registry.userByGoogleSub('google-sub-1')?.dashboardPublic, true,
      'new signups publish Overview and Insights by default');

    assert.equal(registry.userByGoogleSub('google-sub-1')?.matchingOptIn, true);

    // Signup started a session: the cookie opens the dashboard and
    // the account page without any ?key=.
    const sessionCookie = created.headers.getSetCookie().find((v) => v.startsWith('urtube_session='));
    assert.ok(sessionCookie, 'signup sets a session cookie');
    const session = sessionCookie!.split(';')[0];
    assert.equal((await app.request('/newbie', { headers: { cookie: session } })).status, 200);
    assert.equal((await app.request('/account', { headers: { cookie: session } })).status, 200);
    assert.equal((await app.request('/newbie')).status, 200);
    const guided = await (await app.request('/onboarding', { headers: { cookie: session } })).text();
    assert.match(guided, /first scan needs desktop Chrome/);
    assert.match(guided, /href="\/extension-setup"/);
    assert.doesNotMatch(guided, /captureToken|dashboardToken|\?key=/);

    // The pending token is single-use.
    const replay = await app.request('/signup', signupBody(pending, { handle: 'other', displayName: 'Other' }, '10.1.0.2'));
    assert.equal(replay.status, 403);

    // One Google account cannot own two users.
    const again = registry.createPendingSignup('google-sub-1', 'newbie@gmail.com');
    const dupGoogle = await app.request('/signup', signupBody(again, { handle: 'second', displayName: 'Second' }, '10.1.0.3'));
    assert.equal(dupGoogle.status, 409);

    // Taken handles and invalid handles are still rejected.
    const p2 = registry.createPendingSignup('google-sub-2', 'two@gmail.com');
    assert.equal((await app.request('/signup', signupBody(p2, { handle: 'newbie', displayName: 'Dup' }, '10.1.0.4'))).status, 409);
    assert.equal((await app.request('/signup', signupBody(p2, { handle: 'Bad Handle!', displayName: 'Bad' }, '10.1.0.5'))).status, 400);

  } finally {
    registry.close();
  }
});

test('claiming links a Google account to a pre-Google user via its dashboard key', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const legacy = registry.createUser('oldtimer', 'Old Timer');
    const pending = registry.createPendingSignup('google-sub-9', 'old@gmail.com');

    const wrong = await app.request('/signup', signupBody(pending, { claimHandle: 'oldtimer', claimKey: 'nope' }));
    assert.equal(wrong.status, 400);

    const claimed = await app.request('/signup', signupBody(pending, { claimHandle: 'oldtimer', claimKey: legacy.dashboardToken }));
    assert.equal(claimed.status, 302);
    assert.equal(claimed.headers.get('location'), '/onboarding');
    assert.equal(registry.userByGoogleSub('google-sub-9')?.handle, 'oldtimer');

    // The session from the claim opens the private dashboard.
    const session = claimed.headers.getSetCookie().find((v) => v.startsWith('urtube_session='))!.split(';')[0];
    assert.equal((await app.request('/oldtimer', { headers: { cookie: session } })).status, 200);

    // A second Google account cannot claim the same user again... but the
    // same claim key is now moot: the sub is taken by oldtimer.
    const other = registry.createPendingSignup('google-sub-10', 'thief@gmail.com');
    const reclaim = await app.request('/signup', signupBody(other, { claimHandle: 'oldtimer', claimKey: legacy.dashboardToken }));
    assert.equal(reclaim.status, 302, 'owner proving the key again may relink');
    assert.equal(registry.userByGoogleSub('google-sub-10')?.handle, 'oldtimer');
    assert.equal(registry.userByGoogleSub('google-sub-9'), null);
  } finally {
    registry.close();
  }
});

test('account page rotates tokens behind a session and logout ends it', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const pending = registry.createPendingSignup('google-sub-20', 'rot@gmail.com');
    const created = await app.request('/signup', signupBody(pending, { handle: 'rotator', displayName: 'Rotator' }));
    const session = created.headers.getSetCookie().find((v) => v.startsWith('urtube_session='))!.split(';')[0];

    assert.equal((await app.request('/account')).status, 302);
    const rotated = await app.request('/account/rotate', { method: 'POST', headers: { cookie: session } });
    assert.equal(rotated.status, 200);
    const tokens = [...(await rotated.text()).matchAll(/<code class="ob-token">([A-Za-z0-9_-]{40,})<\/code>/g)].map((m) => m[1]);
    assert.equal(tokens.length, 2, 'rotate shows both new tokens once');
    assert.ok(registry.userByDashboardToken('rotator', tokens[1]), 'second token is the dashboard key');

    // A signed-in visitor gets a direct door to their own dashboard on /.
    const home = await (await app.request('/', { headers: { cookie: session } })).text();
    assert.match(home, /href="\/rotator"/);
    assert.match(home, /Open my dashboard/);

    const out = await app.request('/logout', { method: 'POST', headers: { cookie: session } });
    assert.equal(out.status, 302);
    assert.equal((await app.request('/account', { headers: { cookie: session } })).status, 302);
  } finally {
    registry.close();
  }
});

test('retired taxonomy review redirects to processing and refuses mutations without deleting legacy data', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const owner = registry.createUser('topic-owner', 'Topic Owner');
    const cookie = `urtube_session=${registry.createSession(owner)}`;
    const repository = registry.repositoryFor(owner);
    repository.replaceYoutubeTaxonomy([{ version: 1, slug: 'retained-topic', name: 'Retained topic', description: 'Legacy fixture' }]);
    const before = {
      topics: repository.youtubeTopics(),
      runs: repository.youtubeTaxonomyRuns(),
      activations: repository.youtubeTaxonomyActivations(),
    };
    const anonymous = await app.request('/account/taxonomy');
    assert.equal(anonymous.status, 302);
    for (const [query, location] of [
      ['', '/account#processing'],
      ['?lang=zh', '/account?lang=zh#processing'],
      ['?lang=en', '/account?lang=en#processing'],
      ['?lang=invalid&next=https://example.test', '/account?lang=en#processing'],
    ]) {
      const page = await app.request(`/account/taxonomy${query}`, { headers: { cookie } });
      assert.equal(page.status, 302);
      assert.equal(page.headers.get('location'), location);
    }
    for (const path of ['/account/taxonomy/prepare', '/account/taxonomy/1/activate']) {
      const rejected = await app.request(path, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'confirmed=1&reviewed=1',
      });
      assert.equal(rejected.status, 410);
      assert.equal((await app.request(path, { method: 'POST' })).status, 302);
    }
    assert.deepEqual({
      topics: repository.youtubeTopics(),
      runs: repository.youtubeTaxonomyRuns(),
      activations: repository.youtubeTaxonomyActivations(),
    }, before);
    const account = await app.request('/account', { headers: { cookie } });
    assert.doesNotMatch(await account.text(), /href="\/account\/taxonomy"/);
  } finally {
    registry.close();
  }
});

test('account Takeout import is always visible, session-only, and idempotent', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const pending = registry.createPendingSignup('google-sub-takeout', 'takeout@gmail.com');
    const created = await app.request('/signup', signupBody(pending, {
      handle: 'takeout-user', displayName: 'Takeout User',
    }, '10.1.9.1'));
    const session = created.headers.getSetCookie().find((v) => v.startsWith('urtube_session='))!.split(';')[0];
    const account = await (await app.request('/account', { headers: { cookie: session } })).text();
    assert.match(account, /<section id="account-takeout">/);
    assert.doesNotMatch(account, /<details class="ob-advanced"/);
    assert.match(account, /action="\/account\/takeout"/);
    assert.match(account, /takeout\.google\.com/);
    assert.match(account, /set History to <strong>HTML<\/strong>, not JSON/);
    assert.match(account, /does not need your music, library, or uploaded videos/);

    const chineseAccount = await (await app.request('/account?lang=zh', {
      headers: { cookie: session },
    })).text();
    assert.match(chineseAccount, /將歷史記錄設為 <strong>HTML<\/strong>，不要選 JSON/);
    assert.match(chineseAccount, /不需要你的音樂、媒體庫或上傳影片/);

    const unauthenticated = await app.request('/account/takeout', { method: 'POST' });
    assert.equal(unauthenticated.status, 302);

    const wrongType = await app.request('/account/takeout', {
      method: 'POST', headers: { cookie: session, 'content-type': 'text/plain' }, body: 'not a zip',
    });
    assert.equal(wrongType.status, 400);
    assert.match(await wrongType.text(), /Choose the original Google Takeout \.zip file/);

    const upload = () => {
      const form = new FormData();
      const bytes = accountTakeoutZip();
      form.set('takeout', new File([bytes.slice().buffer as ArrayBuffer], 'takeout.zip', { type: 'application/zip' }));
      return app.request('/account/takeout', { method: 'POST', headers: { cookie: session }, body: form });
    };
    const first = await upload();
    assert.equal(first.status, 200);
    const firstHtml = await first.text();
    assert.match(firstHtml, /Import complete: 1 of 1 watch records/);
    assert.equal(registry.repositoryFor(registry.userByHandle('takeout-user')!).youtubeCounts().videoWatches, 1);

    const repeated = await upload();
    assert.equal(repeated.status, 200);
    assert.match(await repeated.text(), /Import complete: 0 of 1 watch records/);
  } finally {
    registry.close();
  }
});

test('login states and pending signups are single-use and expire', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const state = registry.createLoginState();
    assert.deepEqual(registry.consumeLoginState(state), { valid: true, next: '' });
    assert.equal(registry.consumeLoginState(state).valid, false);
    assert.equal(registry.consumeLoginState('missing').valid, false);
    const withNext = registry.createLoginState('/extension-setup');
    assert.deepEqual(registry.consumeLoginState(withNext), { valid: true, next: '/extension-setup' });

    const pending = registry.createPendingSignup('sub-x', 'x@gmail.com');
    assert.deepEqual(registry.pendingSignup(pending), {
      sub: 'sub-x', email: 'x@gmail.com', avatarUrl: null,
    });
    const pictured = registry.createPendingSignup(
      'sub-picture', 'picture@gmail.com', 'https://lh3.googleusercontent.com/a/picture',
    );
    assert.equal(registry.pendingSignup(pictured)?.avatarUrl, 'https://lh3.googleusercontent.com/a/picture');
    registry.consumePendingSignup(pending);
    assert.equal(registry.pendingSignup(pending), null);
  } finally {
    registry.close();
  }
});

test('account page toggles dashboard visibility and edits the display name', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const pending = registry.createPendingSignup('google-sub-30', 'vis@gmail.com');
    const created = await app.request('/signup', signupBody(pending, { handle: 'vis', displayName: 'Vis' }));
    const session = created.headers.getSetCookie().find((v) => v.startsWith('urtube_session='))!.split(';')[0];

    // Public by default; the visibility form still supports opting out.
    assert.equal((await app.request('/vis')).status, 200);
    const publish = await app.request('/account/visibility', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'dashboardPublic=1',
    });
    assert.equal(publish.status, 302);
    assert.equal((await app.request('/vis')).status, 200);
    await app.request('/account/visibility', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    assert.equal((await app.request('/vis')).status, 404);

    // The account page carries the extension download + update steps, and the
    // public version endpoint matches the bundled manifest.
    const { readFileSync } = await import('node:fs');
    const bundledVersion = JSON.parse(readFileSync(new URL('../chrome-extension/manifest.json', import.meta.url), 'utf8')).version;
    const accountHtml = await (await app.request('/account', { headers: { cookie: session } })).text();
    assert.match(accountHtml, /extension\.zip/);
    assert.ok(accountHtml.includes(`v${bundledVersion}`), 'account shows the bundled extension version');
    assert.deepEqual(await (await app.request('/extension-version.json')).json(), { version: bundledVersion });

    // Display name edits apply immediately with the session-bound form token.
    const editHtml = await (await app.request('/account/profile', { headers: { cookie: session } })).text();
    const csrf = editHtml.match(/name="csrf" value="([^"]+)"/)![1];
    await app.request('/account/profile', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({displayName: 'Renamed Vis', handle: 'vis', bio: '', csrf}).toString(),
    });
    assert.equal(registry.userByHandle('vis')?.displayName, 'Renamed Vis');

    // Private dashboards carry a noindex header; robots.txt hides app pages.
    const privateDash = await app.request('/vis', { headers: { cookie: session } });
    assert.equal(privateDash.headers.get('x-robots-tag'), 'noindex');
    assert.match(await (await app.request('/robots.txt')).text(), /Disallow: \/account/);

  } finally {
    registry.close();
  }
});

test('self-serve deletion needs the retyped handle and spares the owner', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const pending = registry.createPendingSignup('google-sub-40', 'del@gmail.com');
    const created = await app.request('/signup', signupBody(pending, { handle: 'deleteme', displayName: 'Del' }));
    const session = created.headers.getSetCookie().find((v) => v.startsWith('urtube_session='))!.split(';')[0];
    const post = (body: string) => app.request('/account/delete', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    assert.equal((await post('confirmHandle=wrong')).status, 400);
    assert.ok(registry.userByHandle('deleteme'));
    const gone = await post('confirmHandle=deleteme');
    assert.equal(gone.status, 302);
    assert.equal(registry.userByHandle('deleteme'), null);
    assert.equal(registry.userByGoogleSub('google-sub-40'), null);
    // The deleted session no longer opens /account.
    assert.equal((await app.request('/account', { headers: { cookie: session } })).status, 302);

    // The owner's account refuses self-deletion.
    const owner = registry.ensureDefaultUser();
    registry.linkGoogle(owner.handle, 'google-sub-owner', 'owner@gmail.com');
    const ownerSession = `urtube_session=${registry.createSession(registry.userByHandle(owner.handle)!)}`;
    const refused = await app.request('/account/delete', {
      method: 'POST',
      headers: { cookie: ownerSession, 'content-type': 'application/x-www-form-urlencoded' },
      body: `confirmHandle=${owner.handle}`,
    });
    assert.equal(refused.status, 400);
    assert.ok(registry.userByHandle(owner.handle));
  } finally {
    registry.close();
  }
});

test('extension-setup provisions a fresh capture token without breaking the dashboard key', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  const ingest = createIngestApp(registry);
  try {
    // Signed out: the page bounces through Google login and the token
    // endpoint refuses.
    const anon = await app.request('/extension-setup');
    assert.equal(anon.status, 302);
    assert.match(anon.headers.get('location') ?? '', /auth\/google\?next=/);
    assert.equal((await app.request('/extension-setup/token', { method: 'POST' })).status, 401);

    const created = registry.createUser('prov', 'Prov', {
      googleSub: 'google-sub-50', googleEmail: 'prov@gmail.com',
    });
    const session = `urtube_session=${registry.createSession(created)}`;
    const dashboardKey = created.dashboardToken;

    const page = await app.request('/extension-setup', { headers: { cookie: session } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /data-urtube-provision/);

    const provisioned = await app.request('/extension-setup/token', { method: 'POST', headers: { cookie: session } });
    assert.equal(provisioned.status, 200);
    const payload = await provisioned.json() as { endpoint: string; token: string; googleAccount: string };
    assert.match(payload.endpoint, /\/api\/ingest\/youtube\/capture$/);
    assert.equal(payload.googleAccount, 'prov@gmail.com');

    // The fresh token authenticates ingest as this user...
    const status = await ingest.request('/api/ingest/youtube/capture/status', {
      headers: { authorization: `Bearer ${payload.token}` },
    });
    assert.equal(((await status.json()) as Record<string, unknown>).user, 'prov');
    // ...and the dashboard key survived the capture-token rotation.
    assert.ok(registry.userByDashboardToken('prov', dashboardKey));

    // handle-check is pending-gated and truthful.
    assert.equal((await app.request('/signup/handle-check?handle=prov')).status, 403);
    const p2 = registry.createPendingSignup('google-sub-51', 'check@gmail.com');
    const checkCookie = { headers: { cookie: `urtube_signup=${p2}` } };
    assert.deepEqual(await (await app.request('/signup/handle-check?handle=prov', checkCookie)).json(), { available: false });
    assert.deepEqual(await (await app.request('/signup/handle-check?handle=fresh-name', checkCookie)).json(), { available: true });
  } finally {
    registry.close();
  }
});

test('signups are rate-limited per IP', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    let limited = 0;
    for (let index = 0; index < 8; index++) {
      const pending = registry.createPendingSignup(`rl-sub-${index}`, `rl${index}@gmail.com`);
      const response = await app.request('/signup', signupBody(pending, { handle: `rluser${index}`, displayName: 'RL' }, '10.9.9.9'));
      if (response.status === 429) limited++;
    }
    assert.ok(limited >= 3, `expected later signups to be limited, got ${limited}`);
  } finally {
    registry.close();
  }
});

test('new signups stop at the configured instance capacity', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  const previous = config.maxUsers;
  try {
    registry.ensureDefaultUser();
    config.maxUsers = 1;
    const pending = registry.createPendingSignup('capacity-sub', 'full@gmail.com');
    const response = await app.request('/signup', signupBody(
      pending,
      { handle: 'one-too-many', displayName: 'Full' },
      '10.8.8.8',
    ));
    assert.equal(response.status, 503);
    assert.match(await response.text(), /account capacity/);
    assert.equal(registry.userByHandle('one-too-many'), null);
  } finally {
    config.maxUsers = previous;
    registry.close();
  }
});

test('readyz accepts a fresh worker heartbeat or completion and rejects failed or stale workers', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  const dir = mkdtempSync(join(tmpdir(), 'urtube-ready-'));
  const previousDirectory = config.opsStatusDirectory;
  const previousSignup = config.signupEnabled;
  try {
    registry.ensureDefaultUser();
    config.opsStatusDirectory = dir;
    config.signupEnabled = false;
    assert.equal((await app.request('/readyz')).status, 503);

    const now = new Date().toISOString();
    writeOpsStatus('backup', { lastCompletedAt: now, lastError: '' });

    writeOpsStatus('worker', {
      lastStartedAt: now, heartbeatAt: now, running: true, failedUsers: 0, lastError: '',
    });
    const ready = await app.request('/readyz');
    assert.equal(ready.status, 200);
    assert.equal((await ready.json() as Record<string, unknown>).status, 'ready');

    writeOpsStatus('worker', {
      lastCompletedAt: now, running: false, failedUsers: 1, lastError: 'previous cycle failed',
    });
    patchOpsStatus<WorkerOpsStatus>('worker', youtubeWorkerCycleStartedStatus(now));
    assert.equal(readOpsStatus<WorkerOpsStatus>('worker')?.lastCompletedAt, now,
      'starting a long catch-up cycle preserves the prior successful completion');
    assert.equal(readOpsStatus<WorkerOpsStatus>('worker')?.failedUsers, 0,
      'starting a retry clears failures from the completed cycle it supersedes');
    assert.equal((await app.request('/readyz')).status, 200);

    writeOpsStatus('worker', {
      lastStartedAt: now,
      heartbeatAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      running: true,
      failedUsers: 0,
      lastError: '',
    });
    assert.equal((await app.request('/readyz')).status, 503);

    writeOpsStatus('worker', {
      heartbeatAt: now, running: false, failedUsers: 0, lastError: '',
    });
    assert.equal((await app.request('/readyz')).status, 503,
      'a stopped worker cannot rely on its last heartbeat');

    writeOpsStatus('worker', {
      lastCompletedAt: now, running: false, failedUsers: 0, lastError: '',
    });
    assert.equal((await app.request('/readyz')).status, 200);

    writeOpsStatus('worker', {
      lastCompletedAt: now, running: false, failedUsers: 1, lastError: 'one archive failed',
    });
    assert.equal((await app.request('/readyz')).status, 503);
  } finally {
    config.opsStatusDirectory = previousDirectory;
    config.signupEnabled = previousSignup;
    registry.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extension download serves a zip of the pinned extension', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const response = await app.request('/extension.zip');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    // The saved file names the build it contains; the folder inside stays
    // urtube-extension/ because an unpacked ID is derived from its path.
    const { readFileSync } = await import('node:fs');
    const bundled = JSON.parse(readFileSync(
      new URL('../chrome-extension/manifest.json', import.meta.url), 'utf8')).version;
    assert.equal(
      response.headers.get('content-disposition'),
      `attachment; filename="urtube-youtube-capture-${bundled}.zip"`,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
    assert.ok(bytes.length > 10_000);
  } finally {
    registry.close();
  }
});

test('deleted users lose access and their handle frees up', async () => {
  const registry = new UserRegistry(':memory:');
  const ingest = createIngestApp(registry);
  try {
    const user = registry.createUser('gone', 'Soon Gone');
    registry.deleteUser('gone');
    assert.equal(registry.userByHandle('gone'), null);
    const status = await ingest.request('/api/ingest/youtube/capture/status', {
      headers: { authorization: `Bearer ${user.captureToken}` },
    });
    assert.equal(status.status, 401);
    assert.throws(() => registry.deleteUser('sky'), /instance owner/);
    registry.createUser('gone', 'Again');
  } finally {
    registry.close();
  }
});
