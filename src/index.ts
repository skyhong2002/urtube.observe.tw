import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { zipSync } from 'fflate';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { config } from './config.js';
import { comparePage, shiftsSection } from './output/crystal.js';
import { dashboardSetupSection, signupPage, welcomePage } from './output/onboarding.js';
import { buildYoutubeCrystal, compareCrystals } from './youtube/crystal.js';
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

// The unpacked extension, zipped once on first request so new users can
// download exactly what this instance expects (endpoint already pinned).
let extensionZip: Uint8Array | null = null;
function buildExtensionZip(): Uint8Array {
  if (!extensionZip) {
    const dir = join(fileURLToPath(new URL('..', import.meta.url)), 'chrome-extension');
    const files: Record<string, Uint8Array> = {};
    for (const name of readdirSync(dir)) {
      files[`urtube-extension/${name}`] = readFileSync(join(dir, name));
    }
    extensionZip = zipSync(files, { level: 9 });
  }
  return extensionZip;
}

// Minimal in-memory signup throttle; behind Caddy the client lands in the
// first X-Forwarded-For entry.
const signupHits = new Map<string, number[]>();
function signupAllowed(ip: string, now = Date.now()): boolean {
  const hits = (signupHits.get(ip) ?? []).filter((at) => now - at < 3600_000);
  if (hits.length >= config.signupPerHourPerIp) {
    signupHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  signupHits.set(ip, hits);
  return true;
}

function clientIp(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
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
      // Path '/' so /compare can also see which dashboards this browser may
      // read.
      setCookie(c, cookieName, key, {
        httpOnly: true, sameSite: 'Lax', path: '/',
        secure: config.publicBaseUrl.startsWith('https://'), maxAge: 180 * 86400,
      });
    }
    return true;
  }

  function dashboardResponse(c: Context, user: User, basePath: string) {
    const repository = registry.repositoryFor(user);
    const data = repository.youtubeDashboard(requestedRange(c.req.query('range')));
    const hasData = repository.youtubeCounts().watches > 0;
    c.header('Cache-Control', 'no-cache');
    return c.html(youtubeDashboardPage(user.displayName, data, requestedSort(c.req.query('sort')), {
      basePath,
      nav: [{ label: 'Dashboard', href: basePath, active: true }],
      setupHtml: dashboardSetupSection(user, hasData)
        + (hasData ? shiftsSection(buildYoutubeCrystal(repository, user)) : ''),
    }));
  }

  app.get('/', (c) => {
    const body = `<section class="page-intro"><div><div class="eyebrow">Private attention archive</div><h1>urtube</h1>
      <p>Your YouTube life, archived privately: watch history from Takeout and Google My Activity, measured
      viewing time from the Chrome extension, saved progress, channels, and AI topics. Searches are encrypted;
      raw history never leaves this server.</p>
      ${config.signupEnabled ? '<div class="hero-actions" style="margin-top:22px"><a href="/signup" style="background:var(--text);border-radius:999px;color:#111;font-weight:700;padding:11px 18px;text-decoration:none">Create your archive →</a></div>' : ''}</div></section>
      <p><a href="/youtube">See a live example: ${html(config.ownerName)}'s dashboard →</a></p>
      <p class="muted">Already have an account? Open the dashboard link you saved at signup
      (<code>/u/&lt;handle&gt;?key=…</code>) — after the first visit a cookie keeps you signed in.</p>`;
    return c.html(shell('urtube', body, [
      { label: 'Create your archive', href: '/signup' },
      { label: 'Example dashboard', href: '/youtube' },
    ]));
  });

  app.get('/signup', (c) => {
    if (!config.signupEnabled) return c.text('Signups are disabled on this instance', 403);
    return c.html(signupPage());
  });

  app.post('/signup', async (c) => {
    if (!config.signupEnabled) return c.text('Signups are disabled on this instance', 403);
    if (!signupAllowed(clientIp(c))) {
      return c.html(signupPage('Too many signups from your network — try again in an hour.'), 429);
    }
    const form = await c.req.parseBody();
    const handle = String(form.handle ?? '').trim().toLocaleLowerCase('en-US');
    const displayName = String(form.displayName ?? '').trim().slice(0, 80);
    const dashboardPublic = form.dashboardPublic === '1';
    if (!displayName) return c.html(signupPage('A display name is required.'), 400);
    try {
      if (registry.userByHandle(handle)) {
        return c.html(signupPage(`The handle “${handle}” is already taken.`), 409);
      }
      const created = registry.createUser(handle, displayName, { dashboardPublic });
      c.header('Cache-Control', 'no-store');
      return c.html(welcomePage(created), 201);
    } catch (error) {
      return c.html(signupPage(error instanceof Error ? error.message : String(error)), 400);
    }
  });

  app.get('/extension.zip', (c) => {
    const zip = buildExtensionZip();
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', 'attachment; filename="urtube-extension.zip"');
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer);
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

  app.get('/u/:handle/crystal.json', (c) => {
    const user = registry.userByHandle(c.req.param('handle'));
    if (!user || !dashboardAccess(c, user)) return c.json({ error: 'not found' }, 404);
    return c.json(buildYoutubeCrystal(registry.repositoryFor(user), user));
  });

  app.get('/api/youtube/crystal.json', (c) => {
    const user = registry.ensureDefaultUser();
    if (!dashboardAccess(c, user)) return c.json({ error: 'not found' }, 404);
    return c.json(buildYoutubeCrystal(registry.repositoryFor(user), user));
  });

  // Cross-person difference view. The requester must be allowed to see BOTH
  // dashboards (public, ?key= / keyA/keyB, or cookies set by earlier visits).
  app.get('/compare', (c) => {
    const aHandle = c.req.query('a') ?? '';
    const bHandle = c.req.query('b') ?? '';
    const a = registry.userByHandle(aHandle);
    const b = registry.userByHandle(bHandle);
    if (!a || !b || a.handle === b.handle) {
      return c.text('Pass two different handles: /compare?a=<handle>&b=<handle>', 400);
    }
    const keyed = (user: User, param: string): boolean => {
      const key = c.req.query(param) ?? '';
      return Boolean(key && registry.userByDashboardToken(user.handle, key));
    };
    const allowed = (user: User, param: string): boolean =>
      user.dashboardPublic
      || keyed(user, param)
      || Boolean(registry.userByDashboardToken(user.handle, getCookie(c, `urtube_dash_${user.handle}`) ?? ''));
    if (!allowed(a, 'keyA') || !allowed(b, 'keyB')) return c.text('Not found', 404);
    const comparison = compareCrystals(
      buildYoutubeCrystal(registry.repositoryFor(a), a),
      buildYoutubeCrystal(registry.repositoryFor(b), b),
    );
    c.header('Cache-Control', 'no-cache');
    return c.html(comparePage(comparison, `/u/${a.handle}`));
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
