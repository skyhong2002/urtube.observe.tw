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
import { brandMark, html, shell } from './output/pages.js';
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
    const landingStyles = `
      .lp-hero{margin:8vh 0 60px;max-width:760px}
      .lp-hero .lp-mark{height:52px;margin-bottom:26px;width:52px}
      .lp-hero h1{font-size:clamp(38px,6.5vw,68px);font-weight:750;letter-spacing:-.045em;line-height:1.02;margin:0 0 18px}
      .lp-hero h1 em{color:var(--accent-text);font-style:normal}
      .lp-hero p{color:var(--ink-2);font-size:16px;line-height:1.65;margin:0;max-width:600px}
      .lp-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}
      .lp-actions a{border-radius:999px;font-size:14px;font-weight:700;padding:12px 20px;text-decoration:none}
      .lp-actions a.lp-primary{background:var(--accent);color:#fff}
      .lp-actions a.lp-primary:hover{background:#b02f2f}
      .lp-actions a.lp-ghost{border:1px solid var(--line-strong);color:var(--ink)}
      .lp-actions a.lp-ghost:hover{border-color:var(--muted)}
      .lp-points{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));margin-top:56px}
      .lp-point{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:20px 22px}
      .lp-point strong{display:block;font-size:14px;margin-bottom:6px}
      .lp-point p{color:var(--ink-2);font-size:13px;line-height:1.6;margin:0}
      .lp-note{color:var(--muted);font-size:12px;margin-top:34px}
    `;
    const body = `<style>${landingStyles}</style><section class="lp-hero">
      <div class="lp-mark">${brandMark}</div>
      <h1>Your YouTube life,<br><em>remembered.</em></h1>
      <p>urtube keeps a private archive of everything you watch — history from Takeout and Google
      My Activity, measured viewing time from a small Chrome extension, saved progress, channels,
      and AI-classified topics. Searches are encrypted; raw history never leaves this server.</p>
      <div class="lp-actions">
        ${config.signupEnabled ? '<a class="lp-primary" href="/signup">Create your archive →</a>' : ''}
        <a class="lp-ghost" href="/youtube">See a live example: ${html(config.ownerName)}</a>
      </div>
    </section>
    <div class="lp-points">
      <div class="lp-point"><strong>Every source, one timeline</strong><p>Takeout backfills years of history; the extension measures real seconds from today forward. Nothing is sampled, nothing expires.</p></div>
      <div class="lp-point"><strong>Private by construction</strong><p>Each account is its own database. Search terms are encrypted at rest, dashboards are private by default, and aggregates are all anyone can ever see.</p></div>
      <div class="lp-point"><strong>See yourself change</strong><p>Attention shifts, channel momentum, and cross-person crystal comparisons show what you're drifting toward — and away from.</p></div>
    </div>
    <p class="lp-note">Already have an account? Open the dashboard link you saved at signup
    (<code>/u/&lt;handle&gt;?key=…</code>) — after the first visit a cookie keeps you signed in.</p>`;
    return c.html(shell('urtube', body, [
      { label: 'Create your archive', href: '/signup' },
      { label: 'Example dashboard', href: '/youtube' },
    ]));
  });

  // The brand mark, served for browser tabs and OG scrapers.
  let faviconSvg: string | null = null;
  app.get('/favicon.svg', (c) => {
    if (faviconSvg === null) {
      faviconSvg = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'favicon.svg'), 'utf8');
    }
    c.header('Content-Type', 'image/svg+xml');
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(faviconSvg);
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
