import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { createIngestApp } from '../src/ingest.js';
import { UserRegistry } from '../src/users.js';

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

test('Google-gated signup creates a working account and shows tokens exactly once', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  const ingest = createIngestApp(registry);
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
    assert.match(await form.text(), /newbie@gmail\.com/);

    const created = await app.request('/signup', signupBody(pending, { handle: 'newbie', displayName: 'New User' }));
    assert.equal(created.status, 201);
    const pageHtml = await created.text();
    const captureToken = pageHtml.match(/<code class="ob-token">([A-Za-z0-9_-]{40,})<\/code>/)?.[1];
    assert.ok(captureToken, 'welcome page shows the capture token');
    const dashboardKey = pageHtml.match(/\/newbie\?key=([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(dashboardKey, 'welcome page links the private dashboard with its key');
    assert.equal(registry.userByGoogleSub('google-sub-1')?.handle, 'newbie');

    // Signup started a session: the cookie opens the private dashboard and
    // the account page without any ?key=.
    const sessionCookie = created.headers.getSetCookie().find((v) => v.startsWith('urtube_session='));
    assert.ok(sessionCookie, 'signup sets a session cookie');
    const session = sessionCookie!.split(';')[0];
    assert.equal((await app.request('/newbie', { headers: { cookie: session } })).status, 200);
    assert.equal((await app.request('/account', { headers: { cookie: session } })).status, 200);
    assert.equal((await app.request('/newbie')).status, 404);

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

    // The shown capture token authenticates ingest for this user only.
    const status = await ingest.request('/api/ingest/youtube/capture/status', {
      headers: { authorization: `Bearer ${captureToken}` },
    });
    assert.equal(status.status, 200);
    assert.equal(((await status.json()) as Record<string, unknown>).user, 'newbie');

    // The dashboard key still works standalone (extension-era links).
    const dashboard = await app.request(`/newbie?key=${dashboardKey}`);
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /finish your setup/);
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
    assert.equal(claimed.headers.get('location'), '/oldtimer');
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

    const out = await app.request('/logout', { method: 'POST', headers: { cookie: session } });
    assert.equal(out.status, 302);
    assert.equal((await app.request('/account', { headers: { cookie: session } })).status, 302);
  } finally {
    registry.close();
  }
});

test('login states and pending signups are single-use and expire', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const state = registry.createLoginState();
    assert.equal(registry.consumeLoginState(state), true);
    assert.equal(registry.consumeLoginState(state), false);
    assert.equal(registry.consumeLoginState('missing'), false);

    const pending = registry.createPendingSignup('sub-x', 'x@gmail.com');
    assert.deepEqual(registry.pendingSignup(pending), { sub: 'sub-x', email: 'x@gmail.com' });
    registry.consumePendingSignup(pending);
    assert.equal(registry.pendingSignup(pending), null);
  } finally {
    registry.close();
  }
});

test('account page toggles dashboard visibility and imports Takeout uploads', async () => {
  const { zipSync, strToU8 } = await import('fflate');
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const pending = registry.createPendingSignup('google-sub-30', 'vis@gmail.com');
    const created = await app.request('/signup', signupBody(pending, { handle: 'vis', displayName: 'Vis' }));
    const session = created.headers.getSetCookie().find((v) => v.startsWith('urtube_session='))!.split(';')[0];

    // Private by default; the visibility form flips it both ways.
    assert.equal((await app.request('/vis')).status, 404);
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

    // Takeout upload through the browser form lands in this user's archive.
    const zip = zipSync({
      'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify([{
        header: 'YouTube', title: 'Watched Uploaded Video',
        titleUrl: 'https://www.youtube.com/watch?v=UPLOADVID01',
        subtitles: [{ name: 'Upload Channel', url: 'https://www.youtube.com/channel/UCupload' }],
        time: '2026-07-01T10:00:00Z', products: ['YouTube'],
      }])),
    });
    const form = new FormData();
    form.set('archive', new File([zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer], 'takeout.zip', { type: 'application/zip' }));
    const uploaded = await app.request('/account/takeout', { method: 'POST', headers: { cookie: session }, body: form });
    assert.equal(uploaded.status, 201);
    assert.match(await uploaded.text(), /1 new watch event/);
    const counts = registry.repositoryFor(registry.userByHandle('vis')!).youtubeCounts();
    assert.equal(counts.watches, 1);

    // Display name edits apply immediately.
    await app.request('/account/profile', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'displayName=Renamed Vis',
    });
    assert.equal(registry.userByHandle('vis')?.displayName, 'Renamed Vis');

    // Private dashboards carry a noindex header; robots.txt hides app pages.
    const privateDash = await app.request('/vis', { headers: { cookie: session } });
    assert.equal(privateDash.headers.get('x-robots-tag'), 'noindex');
    assert.match(await (await app.request('/robots.txt')).text(), /Disallow: \/account/);

    // Empty and unauthenticated uploads are rejected.
    const empty = await app.request('/account/takeout', { method: 'POST', headers: { cookie: session }, body: new FormData() });
    assert.equal(empty.status, 400);
    assert.equal((await app.request('/account/takeout', { method: 'POST', body: new FormData() })).status, 302);
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

test('extension download serves a zip of the pinned extension', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const response = await app.request('/extension.zip');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
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
