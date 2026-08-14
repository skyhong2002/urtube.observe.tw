import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { createIngestApp } from '../src/ingest.js';
import { UserRegistry } from '../src/users.js';

function signupBody(handle: string, displayName = 'Test User', extra: Record<string, string> = {}): RequestInit {
  const body = new URLSearchParams({ handle, displayName, ...extra });
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  };
}

test('self-serve signup creates a working account and shows tokens exactly once', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  const ingest = createIngestApp(registry);
  try {
    assert.equal((await app.request('/signup')).status, 200);

    const created = await app.request('/signup', {
      ...signupBody('newbie', 'New User'),
      headers: { ...signupBody('newbie').headers as Record<string, string>, 'x-forwarded-for': '10.1.0.1' },
    });
    assert.equal(created.status, 201);
    const pageHtml = await created.text();
    const captureToken = pageHtml.match(/<code class="ob-token">([A-Za-z0-9_-]{40,})<\/code>/)?.[1];
    assert.ok(captureToken, 'welcome page shows the capture token');
    const dashboardKey = pageHtml.match(/\/u\/newbie\?key=([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(dashboardKey, 'welcome page links the private dashboard with its key');

    // The shown capture token authenticates ingest for this user only.
    const status = await ingest.request('/api/ingest/youtube/capture/status', {
      headers: { authorization: `Bearer ${captureToken}` },
    });
    assert.equal(status.status, 200);
    assert.equal(((await status.json()) as Record<string, unknown>).user, 'newbie');

    // The dashboard key opens the private dashboard, which shows setup help
    // while empty.
    const dashboard = await app.request(`/u/newbie?key=${dashboardKey}`);
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /finish your setup/);
    assert.equal((await app.request('/u/newbie')).status, 404);

    const duplicate = await app.request('/signup', {
      ...signupBody('newbie'),
      headers: { ...signupBody('newbie').headers as Record<string, string>, 'x-forwarded-for': '10.1.0.2' },
    });
    assert.equal(duplicate.status, 409);

    const invalid = await app.request('/signup', {
      ...signupBody('Bad Handle!'),
      headers: { ...signupBody('x').headers as Record<string, string>, 'x-forwarded-for': '10.1.0.3' },
    });
    assert.equal(invalid.status, 400);
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
      const response = await app.request('/signup', {
        ...signupBody(`rluser${index}`),
        headers: {
          ...signupBody('x').headers as Record<string, string>,
          'x-forwarded-for': '10.9.9.9',
        },
      });
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
