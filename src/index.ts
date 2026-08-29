import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { zipSync } from 'fflate';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { completeGoogleLogin, googleLoginUrl, suggestedHandle } from './auth.js';
import { config } from './config.js';
import { comparePage, shiftsSection } from './output/crystal.js';
import { messages, pickLang, type Lang } from './output/i18n.js';
import {
  accountPage, dashboardSetupSection, extensionSetupPage, signupCompletePage, signupStartPage, welcomePage,
} from './output/onboarding.js';
import { buildYoutubeCrystal, compareCrystals, type YoutubeCrystal } from './youtube/crystal.js';
import { brandMark, html, shell, type ShellNavItem } from './output/pages.js';
import { youtubeDashboardPage } from './output/youtube.js';
import { DEFAULT_HANDLE, UserRegistry, type User } from './users.js';
import type { YoutubeDashboardData, YoutubeRange } from './youtube/types.js';

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

// Dashboard aggregates and crystals are pure functions of the event set, so
// cache them keyed on the table counts (cheap to read) with a short TTL as a
// backstop for metadata enrichment that changes estimates without new rows.
const CACHE_TTL_MS = 300_000;
const dashboardCache = new Map<string, { key: string; at: number; data: YoutubeDashboardData }>();
const crystalCache = new Map<string, { key: string; at: number; crystal: YoutubeCrystal }>();
// Handles worth pre-warming: the owner plus anyone whose dashboard was
// actually visited since boot. Keeps the warm sweep (and its open SQLite
// handles) proportional to traffic, not to total signups.
const warmedHandles = new Set<string>();

function validityFor(counts: { watches: number; searches: number; videos: number; channels: number }): string {
  return `${counts.watches}:${counts.searches}:${counts.videos}:${counts.channels}`;
}

function evictUserCaches(handle: string): void {
  for (const range of ['7d', '28d', '90d', 'all']) dashboardCache.delete(`${handle}:${range}`);
  crystalCache.delete(handle);
  warmedHandles.delete(handle);
}

// One cache discipline for every aggregate consumer (dashboard pages,
// crystal.json, /compare, the warm sweep): entries are keyed on the table
// counts with a shared TTL. Callers that already computed counts pass them
// in so a request never runs the COUNT aggregates twice.
function cachedDashboardFor(registry: UserRegistry, user: User, range: YoutubeRange, repository = registry.repositoryFor(user), validity = validityFor(repository.youtubeCounts())): YoutubeDashboardData {
  const now = Date.now();
  const id = `${user.handle}:${range}`;
  let entry = dashboardCache.get(id);
  if (!entry || entry.key !== validity || now - entry.at > CACHE_TTL_MS) {
    entry = { key: validity, at: now, data: repository.youtubeDashboard(range) };
    dashboardCache.set(id, entry);
  }
  return entry.data;
}

function cachedCrystalFor(registry: UserRegistry, user: User, repository = registry.repositoryFor(user), validity = validityFor(repository.youtubeCounts())): YoutubeCrystal {
  const now = Date.now();
  let entry = crystalCache.get(user.handle);
  if (!entry || entry.key !== validity || now - entry.at > CACHE_TTL_MS) {
    entry = { key: validity, at: now, crystal: buildYoutubeCrystal(repository, user) };
    crystalCache.set(user.handle, entry);
  }
  return entry.crystal;
}

export function createApp(registry: UserRegistry): Hono {
  const app = new Hono();

  // Requested language: explicit ?lang= wins (and persists via cookie),
  // then the cookie, then the browser's Accept-Language.
  function langOf(c: Context): Lang {
    const query = c.req.query('lang');
    const lang = pickLang(query, getCookie(c, 'urtube_lang'), c.req.header('accept-language'));
    if (query === 'zh' || query === 'en') {
      setCookie(c, 'urtube_lang', query, {
        path: '/', sameSite: 'Lax', maxAge: 365 * 86400,
        secure: config.publicBaseUrl.startsWith('https://'),
      });
    }
    return lang;
  }

  function langToggle(c: Context, lang: Lang): ShellNavItem {
    const url = new URL(c.req.url);
    url.searchParams.set('lang', lang === 'zh' ? 'en' : 'zh');
    return { label: messages(lang).langToggle, href: `${url.pathname}${url.search}` };
  }

  const secureCookies = config.publicBaseUrl.startsWith('https://');

  function sessionUser(c: Context): User | null {
    const token = getCookie(c, 'urtube_session') ?? '';
    return token ? registry.userBySession(token) : null;
  }

  function startSession(c: Context, user: User): void {
    setCookie(c, 'urtube_session', registry.createSession(user), {
      httpOnly: true, sameSite: 'Lax', path: '/', secure: secureCookies, maxAge: 180 * 86400,
    });
  }

  // A dashboard is viewable when it is public, when the viewer is signed in
  // as its owner, or when the request carries the user's dashboard token
  // (?key=... on first visit, then a cookie).
  function dashboardAccess(c: Context, user: User): boolean {
    if (user.dashboardPublic) return true;
    if (sessionUser(c)?.id === user.id) return true;
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
    const lang = langOf(c);
    const repository = registry.repositoryFor(user);
    const counts = repository.youtubeCounts();
    const validity = validityFor(counts);
    const range = requestedRange(c.req.query('range'));
    const data = cachedDashboardFor(registry, user, range, repository, validity);
    const hasData = counts.watches > 0;
    const viewerOwns = sessionUser(c)?.id === user.id;
    const crystalHtml = hasData ? shiftsSection(cachedCrystalFor(registry, user, repository, validity), lang) : '';
    warmedHandles.add(user.handle);
    c.header('Cache-Control', 'no-cache');
    // Private dashboards reached via key/session must not end up in search
    // engines even if a keyed link leaks into a crawler.
    if (!user.dashboardPublic) c.header('X-Robots-Tag', 'noindex');
    // Setup instructions are for people who can act on them: the owner, a
    // viewer of a private archive — or anyone on a still-empty dashboard,
    // which is otherwise a blank page (and how a CLI-created owner with no
    // session learns the setup steps).
    const showSetup = viewerOwns || !user.dashboardPublic || !hasData;
    return c.html(youtubeDashboardPage(user.displayName, data, requestedSort(c.req.query('sort')), {
      basePath,
      lang,
      nav: [
        { label: messages(lang).navDashboard, href: basePath, active: true },
        ...(viewerOwns ? [{ label: messages(lang).navAccount, href: '/account' }] : []),
        langToggle(c, lang),
      ],
      setupHtml: (showSetup ? dashboardSetupSection(user, hasData, lang) : '') + crystalHtml,
    }));
  }

  app.get('/', (c) => {
    const lang = langOf(c);
    const t = messages(lang);
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
    const points = t.landingPoints.map(([title, copy]) =>
      `<div class="lp-point"><strong>${title}</strong><p>${copy}</p></div>`
    ).join('');
    const me = sessionUser(c);
    const primaryAction = me
      ? `<a class="lp-primary" href="/${html(me.handle)}">${t.landingMyDashboard}</a>`
      : config.signupEnabled ? `<a class="lp-primary" href="/signup">${t.landingCta}</a>` : '';
    const body = `<style>${landingStyles}</style><section class="lp-hero">
      <div class="lp-mark">${brandMark}</div>
      <h1>${t.landingTitle}</h1>
      <p>${t.landingPara}</p>
      <div class="lp-actions">
        ${primaryAction}
        <a class="lp-ghost" href="/${registry.ensureDefaultUser().handle}">${t.landingExample(html(config.ownerName))}</a>
      </div>
    </section>
    <div class="lp-points">${points}</div>
    ${me ? '' : `<p class="lp-note">${t.landingNote}</p>`}`;
    return c.html(shell('', body, [
      me ? { label: t.navAccount, href: '/account' } : { label: t.navSignup, href: '/signup' },
      { label: t.navExample, href: `/${registry.ensureDefaultUser().handle}` },
      langToggle(c, lang),
    ], '', lang));
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

  app.get('/login', (c) => c.redirect('/auth/google'));

  // Google sign-in entry point: also the login for existing accounts, so it
  // stays available even when signups are disabled. ?next=/path continues
  // there after the round trip (same-site paths only).
  app.get('/auth/google', (c) => {
    try {
      return c.redirect(googleLoginUrl(registry, c.req.query('next') ?? ''));
    } catch (error) {
      return c.text(error instanceof Error ? error.message : String(error), 503);
    }
  });

  app.get('/auth/google/callback', async (c) => {
    // e.g. the user pressed Cancel on the Google consent screen.
    if (c.req.query('error')) return c.redirect('/signup');
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return c.text('Missing OAuth code or state', 400);
    try {
      const identity = await completeGoogleLogin(registry, code, state);
      const existing = registry.userByGoogleSub(identity.sub);
      if (existing) {
        startSession(c, existing);
        return c.redirect(identity.next || `/${existing.handle}`);
      }
      // New Google account: park the verified identity and let them pick a
      // handle (or claim a pre-Google account).
      setCookie(c, 'urtube_signup', registry.createPendingSignup(identity.sub, identity.email), {
        httpOnly: true, sameSite: 'Lax', path: '/', secure: secureCookies, maxAge: 1800,
      });
      return c.redirect('/signup');
    } catch (error) {
      return c.text(error instanceof Error ? error.message : String(error), 400);
    }
  });

  app.get('/signup', (c) => {
    const lang = langOf(c);
    const me = sessionUser(c);
    if (me) return c.redirect('/account');
    const pending = registry.pendingSignup(getCookie(c, 'urtube_signup') ?? '');
    if (!pending) return c.html(signupStartPage('', lang));
    return c.html(signupCompletePage({ email: pending.email, suggestedHandle: suggestedHandle(pending.email) }, '', lang));
  });

  app.post('/signup', async (c) => {
    const lang = langOf(c);
    const t = messages(lang);
    const pendingToken = getCookie(c, 'urtube_signup') ?? '';
    const pending = registry.pendingSignup(pendingToken);
    if (!pending) return c.html(signupStartPage('', lang), 403);
    const pageInput = { email: pending.email, suggestedHandle: suggestedHandle(pending.email) };
    const form = await c.req.parseBody();
    const finish = (user: User) => {
      registry.consumePendingSignup(pendingToken);
      deleteCookie(c, 'urtube_signup', { path: '/' });
      startSession(c, user);
    };

    // Claim path: bind this Google account to a pre-Google user by proving
    // ownership with the dashboard key. Allowed even when signups are off.
    const claimHandle = String(form.claimHandle ?? '').trim().toLocaleLowerCase('en-US');
    if (claimHandle) {
      const claimKey = String(form.claimKey ?? '').trim();
      const user = registry.userByDashboardToken(claimHandle, claimKey);
      if (!user) return c.html(signupCompletePage(pageInput, t.errClaimInvalid, lang), 400);
      try {
        const linked = registry.linkGoogle(user.handle, pending.sub, pending.email);
        finish(linked);
        return c.redirect(`/${linked.handle}`);
      } catch (error) {
        return c.html(signupCompletePage(pageInput, error instanceof Error ? error.message : String(error), lang), 409);
      }
    }

    if (!config.signupEnabled) return c.html(signupStartPage(t.errSignupsDisabled, lang), 403);
    if (!signupAllowed(clientIp(c))) {
      return c.html(signupCompletePage(pageInput, t.errTooManySignups, lang), 429);
    }
    const handle = String(form.handle ?? '').trim().toLocaleLowerCase('en-US');
    const displayName = String(form.displayName ?? '').trim().slice(0, 80);
    const dashboardPublic = form.dashboardPublic === '1';
    if (!displayName) return c.html(signupCompletePage(pageInput, t.errNameRequired, lang), 400);
    try {
      if (registry.userByGoogleSub(pending.sub)) {
        return c.html(signupStartPage(t.errGoogleTaken, lang), 409);
      }
      if (registry.userByHandle(handle)) {
        return c.html(signupCompletePage(pageInput, t.errHandleTaken(handle), lang), 409);
      }
      const created = registry.createUser(handle, displayName, {
        dashboardPublic, googleSub: pending.sub, googleEmail: pending.email,
      });
      finish(created);
      c.header('Cache-Control', 'no-store');
      return c.html(welcomePage(created, lang), 201);
    } catch (error) {
      return c.html(signupCompletePage(pageInput, error instanceof Error ? error.message : String(error), lang), 400);
    }
  });

  // One-click extension provisioning: the page the extension opens right
  // after install. It hands the endpoint plus a fresh capture token to the
  // extension via the provision content script, which then starts the first
  // sync — no copy-pasting.
  app.get('/extension-setup', (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/auth/google?next=%2Fextension-setup');
    return c.html(extensionSetupPage(me, langOf(c)));
  });

  app.post('/extension-setup/token', (c) => {
    const me = sessionUser(c);
    if (!me) return c.json({ error: 'not signed in' }, 401);
    c.header('Cache-Control', 'no-store');
    return c.json({
      endpoint: `${config.publicBaseUrl}/api/ingest/youtube/capture`,
      token: registry.rotateCaptureToken(me.handle),
      googleAccount: me.googleEmail ?? '',
    });
  });

  // Live handle-availability check for the signup form; gated behind a
  // verified pending signup so it is not an anonymous enumeration endpoint.
  app.get('/signup/handle-check', (c) => {
    const pending = registry.pendingSignup(getCookie(c, 'urtube_signup') ?? '');
    if (!pending) return c.json({ error: 'no pending signup' }, 403);
    const handle = (c.req.query('handle') ?? '').trim().toLocaleLowerCase('en-US');
    if (!/^[a-z0-9][a-z0-9.-]{1,31}$/.test(handle)) return c.json({ available: false, invalid: true });
    return c.json({ available: !registry.userByHandle(handle) });
  });

  app.get('/account', (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    return c.html(accountPage(me, {}, langOf(c)));
  });

  // Token recovery: rotating invalidates both old tokens and shows the new
  // pair exactly once, same show-once rule as signup.
  app.post('/account/rotate', (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const rotated = registry.rotateTokens(me.handle);
    c.header('Cache-Control', 'no-store');
    return c.html(accountPage(me, { rotated }, langOf(c)));
  });

  app.post('/account/profile', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const form = await c.req.parseBody();
    try {
      registry.setDisplayName(me.handle, String(form.displayName ?? ''));
      // The crystal embeds the display name; drop it so /compare and
      // crystal.json pick up the rename immediately.
      evictUserCaches(me.handle);
      return c.redirect('/account');
    } catch (error) {
      return c.html(accountPage(me, { error: error instanceof Error ? error.message : String(error) }, langOf(c)), 400);
    }
  });

  app.post('/account/visibility', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const form = await c.req.parseBody();
    registry.setDashboardPublic(me.handle, form.dashboardPublic === '1');
    return c.redirect('/account');
  });

  // Browser-friendly Takeout import: same parser and idempotent ingest as
  // the API endpoint, but authenticated by the login session.
  // Self-serve deletion: session plus retyping the handle. deleteUser refuses
  // the instance owner, which we surface as a friendly error.
  app.post('/account/delete', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const lang = langOf(c);
    const t = messages(lang);
    const form = await c.req.parseBody();
    if (String(form.confirmHandle ?? '').trim() !== me.handle) {
      return c.html(accountPage(me, { error: t.errDeleteConfirm }, lang), 400);
    }
    if (me.handle === DEFAULT_HANDLE) {
      return c.html(accountPage(me, { error: t.errOwnerDelete }, lang), 400);
    }
    try {
      registry.deleteUser(me.handle);
    } catch (error) {
      return c.html(accountPage(me, { error: error instanceof Error ? error.message : String(error) }, lang), 500);
    }
    evictUserCaches(me.handle);
    deleteCookie(c, 'urtube_session', { path: '/' });
    return c.redirect('/');
  });

  app.post('/logout', (c) => {
    registry.deleteSession(getCookie(c, 'urtube_session') ?? '');
    deleteCookie(c, 'urtube_session', { path: '/' });
    return c.redirect('/');
  });

  app.get('/privacy', (c) => {
    const lang = langOf(c);
    const t = messages(lang);
    const sections = t.privacySections.map(([heading, para]) =>
      `<h2 style="font-size:16px;margin:26px 0 8px">${heading}</h2><p style="color:var(--ink-2);line-height:1.7;margin:0">${para}</p>`
    ).join('');
    const body = `<section style="margin:6vh auto 0;max-width:720px">
      <div class="eyebrow">${t.privacyLink}</div>
      <h1 style="letter-spacing:-.03em;margin:8px 0 14px">${t.privacyTitle}</h1>
      <p style="color:var(--ink-2)">${t.privacyIntro}</p>
      ${sections}
    </section>`;
    return c.html(shell(t.privacyTitle, body, [{ label: t.navHome, href: '/' }, langToggle(c, lang)], '', lang));
  });

  app.get('/robots.txt', (c) => {
    return c.text('User-agent: *\nDisallow: /compare\nDisallow: /account\nDisallow: /signup\nDisallow: /auth/\n');
  });

  app.get('/extension.zip', (c) => {
    const zip = buildExtensionZip();
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', 'attachment; filename="urtube-extension.zip"');
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer);
  });

  // Legacy owner-dashboard path; the canonical URL is now /<owner handle>.
  app.get('/youtube', (c) => {
    return c.redirect(`/${registry.ensureDefaultUser().handle}`, 301);
  });

  // Legacy dashboard path; JSON endpoints below stay under /u/ so existing
  // API consumers keep working.
  app.get('/u/:handle', (c) => {
    const query = new URL(c.req.url).search;
    return c.redirect(`/${c.req.param('handle')}${query}`, 301);
  });

  app.get('/u/:handle/crystal.json', (c) => {
    const user = registry.userByHandle(c.req.param('handle'));
    if (!user || !dashboardAccess(c, user)) return c.json({ error: 'not found' }, 404);
    return c.json(cachedCrystalFor(registry, user));
  });

  app.get('/api/youtube/crystal.json', (c) => {
    const user = registry.ensureDefaultUser();
    if (!dashboardAccess(c, user)) return c.json({ error: 'not found' }, 404);
    return c.json(cachedCrystalFor(registry, user));
  });

  // Cross-person difference view. The requester must be allowed to see BOTH
  // dashboards (public, ?key= / keyA/keyB, or cookies set by earlier visits).
  app.get('/compare', (c) => {
    const aHandle = c.req.query('a') ?? '';
    const bHandle = c.req.query('b') ?? '';
    const a = registry.userByHandle(aHandle);
    const b = registry.userByHandle(bHandle);
    if (!a || !b || a.handle === b.handle) {
      const lang = langOf(c);
      const t = messages(lang);
      const body = `<section style="margin:16vh auto 10vh;max-width:560px;text-align:center">
        <h1 style="letter-spacing:-.03em;margin:0 0 10px">/compare</h1>
        <p style="color:var(--ink-2)"><code>/compare?a=&lt;handle&gt;&amp;b=&lt;handle&gt;</code></p>
      </section>`;
      return c.html(shell('compare', body, [{ label: t.navHome, href: '/' }], '', lang), 400);
    }
    const me = sessionUser(c);
    const keyed = (user: User, param: string): boolean => {
      const key = c.req.query(param) ?? '';
      return Boolean(key && registry.userByDashboardToken(user.handle, key));
    };
    const allowed = (user: User, param: string): boolean =>
      user.dashboardPublic
      || me?.id === user.id
      || keyed(user, param)
      || Boolean(registry.userByDashboardToken(user.handle, getCookie(c, `urtube_dash_${user.handle}`) ?? ''));
    if (!allowed(a, 'keyA') || !allowed(b, 'keyB')) return notFoundPage(c);
    const comparison = compareCrystals(cachedCrystalFor(registry, a), cachedCrystalFor(registry, b));
    c.header('Cache-Control', 'no-cache');
    // Keyed compare links must not get indexed if they leak to a crawler.
    if (!a.dashboardPublic || !b.dashboardPublic) c.header('X-Robots-Tag', 'noindex');
    return c.html(comparePage(comparison, `/${a.handle}`, langOf(c)));
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

  function notFoundPage(c: Context) {
    const lang = langOf(c);
    const t = messages(lang);
    const body = `<section style="margin:16vh auto 10vh;max-width:520px;text-align:center">
      <h1 style="font-size:72px;letter-spacing:-.05em;line-height:1;margin:0 0 12px">404</h1>
      <p style="color:var(--ink-2)">${t.notFoundPara}</p>
      <p style="margin-top:26px"><a href="/" style="background:var(--accent);border-radius:999px;color:#fff;font-size:14px;font-weight:700;padding:11px 20px;text-decoration:none">${t.navHome}</a></p>
    </section>`;
    return c.html(shell(t.notFoundTitle, body, [{ label: t.navHome, href: '/' }], '', lang), 404);
  }

  // Registered last so every fixed route above wins: /<handle> is the
  // canonical dashboard URL (e.g. /skyhong.tw), with /u/<handle> kept as an
  // alias for existing links.
  app.get('/:handle', (c) => {
    const user = registry.userByHandle(c.req.param('handle'));
    if (!user) return notFoundPage(c);
    if (!dashboardAccess(c, user)) return notFoundPage(c);
    return dashboardResponse(c, user, `/${user.handle}`);
  });

  app.notFound((c) => notFoundPage(c));

  return app;
}

// Best-effort pre-warm of dashboard caches, re-run just inside the TTL so
// the first visitor after a deploy or quiet stretch never pays the aggregate
// cost. Only the owner and handles visited since boot are swept, using the
// exact same cache fills as the serve path.
function warmDashboards(registry: UserRegistry): void {
  // The whole sweep runs inside timer callbacks: any escape here would crash
  // the process (registry reads can throw on SQLITE_BUSY during backups).
  try {
    warmedHandles.add(registry.ensureDefaultUser().handle);
  } catch (error) {
    console.error('dashboard warm failed:', error instanceof Error ? error.message : error);
    return;
  }
  for (const handle of warmedHandles) {
    try {
      const user = registry.userByHandle(handle);
      if (!user) {
        warmedHandles.delete(handle);
        continue;
      }
      const repository = registry.repositoryFor(user);
      const counts = repository.youtubeCounts();
      if (counts.watches === 0) continue;
      const validity = validityFor(counts);
      for (const range of ['7d', '28d', '90d', 'all'] as const) {
        cachedDashboardFor(registry, user, range, repository, validity);
      }
      cachedCrystalFor(registry, user, repository, validity);
    } catch (error) {
      console.error(`dashboard warm failed for ${handle}:`, error instanceof Error ? error.message : error);
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  const registry = new UserRegistry(process.env.USERS_DATABASE_PATH ?? './data/users.sqlite');
  registry.ensureDefaultUser();
  const app = createApp(registry);
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`urtube listening on :${info.port}`);
  });
  setTimeout(() => warmDashboards(registry), 2000);
  setInterval(() => warmDashboards(registry), 240_000).unref();
}
