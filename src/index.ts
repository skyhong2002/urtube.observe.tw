import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { config } from './config.js';
import { html, shell } from './output/pages.js';
import { youtubeDashboardPage } from './output/youtube.js';
import { UserRegistry, type User } from './users.js';
import type { YoutubeRange } from './youtube/types.js';

function requestedRange(value: string | undefined): YoutubeRange {
  return ['7d', '28d', '90d', 'all'].includes(value ?? '') ? value as YoutubeRange : '28d';
}

function requestedSort(value: string | undefined): 'watches' | 'duration' {
  return value === 'watches' ? 'watches' : 'duration';
}

export function createApp(registry: UserRegistry): Hono {
  const app = new Hono();

  // A dashboard is viewable when it is public, or the request carries the
  // user's dashboard token (?key=... on first visit, then a cookie).
  function dashboardAccess(c: Context, user: User): boolean {
    if (user.dashboardPublic) return true;
    const cookieName = `urtube_dash_${user.handle}`;
    const key = c.req.query('key') ?? getCookie(c, cookieName) ?? '';
    if (!registry.userByDashboardToken(user.handle, key)) return false;
    if (c.req.query('key')) {
      setCookie(c, cookieName, key, {
        httpOnly: true, sameSite: 'Lax', path: `/u/${user.handle}`,
        secure: config.publicBaseUrl.startsWith('https://'), maxAge: 180 * 86400,
      });
    }
    return true;
  }

  function dashboardResponse(c: Context, user: User, basePath: string) {
    const repository = registry.repositoryFor(user);
    const data = repository.youtubeDashboard(requestedRange(c.req.query('range')));
    c.header('Cache-Control', 'no-cache');
    return c.html(youtubeDashboardPage(user.displayName, data, requestedSort(c.req.query('sort')), {
      basePath,
      nav: [{ label: 'Dashboard', href: basePath, active: true }],
    }));
  }

  app.get('/', (c) => {
    const body = `<section class="page-intro"><div><div class="eyebrow">Private attention archive</div><h1>urtube</h1>
      <p>A self-hosted archive of your YouTube life: watch history from Takeout and Google My Activity, measured
      viewing time from the Chrome extension, saved progress, channels, and AI topics. Searches are encrypted;
      raw history never leaves this server.</p></div></section>
      <p><a href="/youtube">Open ${html(config.ownerName)}'s dashboard →</a></p>
      <p class="muted">Have an account here? Your dashboard lives at <code>/u/&lt;your-handle&gt;?key=&lt;your dashboard token&gt;</code>.
      Ask the instance owner for an invite: you get a capture token for the Chrome extension and a private dashboard.</p>`;
    return c.html(shell('urtube', body, [{ label: 'Dashboard', href: '/youtube' }]));
  });

  app.get('/youtube', (c) => {
    const user = registry.ensureDefaultUser();
    if (!dashboardAccess(c, user)) return c.text('Not found', 404);
    return dashboardResponse(c, user, '/youtube');
  });

  app.get('/u/:handle', (c) => {
    const user = registry.userByHandle(c.req.param('handle'));
    if (!user) return c.text('Not found', 404);
    if (!dashboardAccess(c, user)) return c.text('Not found', 404);
    return dashboardResponse(c, user, `/u/${user.handle}`);
  });

  app.get('/u/:handle/summary.json', (c) => {
    const user = registry.userByHandle(c.req.param('handle'));
    if (!user || !dashboardAccess(c, user)) return c.json({ error: 'not found' }, 404);
    const data = registry.repositoryFor(user).youtubeDashboard(requestedRange(c.req.query('range')));
    return c.json({ ...data, recent: undefined });
  });

  app.get('/api/youtube/summary.json', (c) => {
    const user = registry.ensureDefaultUser();
    const data = registry.repositoryFor(user).youtubeDashboard(requestedRange(c.req.query('range')));
    return c.json({ ...data, recent: undefined });
  });

  app.get('/api/youtube/recent.json', (c) => {
    const user = registry.ensureDefaultUser();
    const data = registry.repositoryFor(user).youtubeDashboard('28d');
    return c.json({
      range: data.range,
      generatedAt: data.generatedAt,
      data: data.recent.map(({
        watchedAt: _watchedAt,
        actualWatchedSeconds: _actualWatchedSeconds,
        ...video
      }) => video),
    });
  });

  app.get('/status', (c) => {
    const user = registry.ensureDefaultUser();
    const repository = registry.repositoryFor(user);
    return c.json({
      owner: config.ownerName,
      publicBaseUrl: config.publicBaseUrl,
      users: registry.listUsers().length,
      youtube: {
        counts: repository.youtubeCounts(),
        oauthAuthorized: Boolean(repository.youtubeOAuthCredential()),
        sync: {
          checkpoint: repository.youtubeSyncState('checkpoint'),
          activeJob: Boolean(repository.youtubeSyncState('active_job')),
          lastResult: repository.youtubeSyncState('last_result'),
          lastError: repository.youtubeSyncState('last_error'),
        },
        summary: '/api/youtube/summary.json',
      },
    });
  });

  // Healthy whenever the database answers: a freshly deployed, still-empty
  // instance must pass health checks before any data migration happens.
  app.get('/healthz', (c) => {
    try {
      const user = registry.ensureDefaultUser();
      const counts = registry.repositoryFor(user).youtubeCounts();
      return c.json({
        status: 'healthy',
        service: 'urtube',
        counts,
        lastError: registry.repositoryFor(user).youtubeSyncState('last_error') || null,
      });
    } catch (error) {
      return c.json({
        status: 'unhealthy',
        service: 'urtube',
        error: error instanceof Error ? error.message : String(error),
      }, 503);
    }
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const registry = new UserRegistry(process.env.USERS_DATABASE_PATH ?? './data/users.sqlite');
  registry.ensureDefaultUser();
  const app = createApp(registry);
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`urtube listening on :${info.port}`);
  });
}
