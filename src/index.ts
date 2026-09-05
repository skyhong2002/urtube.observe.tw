import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { completeGoogleLogin, googleLoginConfigured, googleLoginUrl, suggestedHandle } from './auth.js';
import { config } from './config.js';
import type { Repository } from './data/database.js';
import { userDataExport } from './data/user-export.js';
import { buildExtensionZip, extensionDownloadName, extensionVersion } from './extension-bundle.js';
import { comparePage, shiftsSection } from './output/crystal.js';
import { messages, pickLang, type Lang } from './output/i18n.js';
import { matchesPage } from './output/matches.js';
import {
  accountPage, dashboardSetupSection, extensionSetupPage, guidedOnboardingPage,
  signupCompletePage, signupStartPage,
  type AccountPageState,
} from './output/onboarding.js';
import { guidedOnboardingState, type GuidedOnboardingState } from './onboarding-flow.js';
import { buildYoutubeCrystal, compareCrystals, type YoutubeCrystal } from './youtube/crystal.js';
import { ensureYoutubeTaxonomy } from './youtube/ai.js';
import {
  brandMark, html, primaryNav, shell,
  type PrimaryNavActive, type ShellNavItem,
} from './output/pages.js';
import { youtubeDashboardPage, type YoutubeDashboardPageKind } from './output/youtube.js';
import { processingNotice } from './output/processing.js';
import {
  describeYoutubeProcessing,
  youtubeProcessingCapabilities,
  type YoutubeProcessingStatus,
} from './youtube/processing.js';
import { tagLeanSection } from './output/taglean.js';
import { personalTaxonomyAuditPage } from './output/taxonomy-audit.js';
import { readOpsStatus, workerOpsReady, type WorkerOpsStatus } from './ops-status.js';
import { securityHeaders } from './security-headers.js';
import { computeTagLean, fetchTagLists } from './youtube/taglists.js';
import { referencePopulation as buildReferencePopulation } from './youtube/reference-population.js';
import { MAX_YOUTUBE_ARCHIVE_BYTES, parseYoutubeArchive } from './youtube/takeout.js';
import { DEFAULT_HANDLE, UserRegistry, type MatchableCrystal, type User } from './users.js';
import type { MatchingDisclosureLevel } from './youtube/disclosure.js';
import {
  MATCHING_CANDIDATE_POOL_LIMIT,
  matchingCandidateBatch,
  rankedMatchingCandidateCards,
} from './youtube/candidates.js';
import {
  cohortChannelPolicy,
  cohortRecommendations,
  type CohortChannelPolicy,
  type CohortRecommendations,
} from './youtube/cohort-recommendations.js';
import { registryCrystalEligible } from './youtube/registry-crystal.js';
import type { TagListSnapshot } from './youtube/taglists.js';
import { YOUTUBE_RANGES, type YoutubeDashboardData, type YoutubeRange } from './youtube/types.js';
import { PERSONAL_TAXONOMY_DEFINITION_VERSION } from './youtube/personal-taxonomy.js';

function requestedRange(value: string | undefined): YoutubeRange {
  return YOUTUBE_RANGES.includes(value as YoutubeRange) ? value as YoutubeRange : '28d';
}

function requestedSort(value: string | undefined): 'watches' | 'duration' {
  return value === 'watches' ? 'watches' : 'duration';
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

// Pending enrichment rides along in the key: the worker changes estimates
// and topics without adding rows, and readers should see that promptly
// rather than after the TTL.
function validityFor(
  counts: { watches: number; searches: number; videos: number; channels: number },
  processing: { pending: number },
): string {
  return `${counts.watches}:${counts.searches}:${counts.videos}:${counts.channels}:${processing.pending}`;
}

function processingFor(repository: Repository): YoutubeProcessingStatus {
  return describeYoutubeProcessing(repository.youtubeProcessingCounts(), youtubeProcessingCapabilities());
}

function evictUserCaches(handle: string): void {
  for (const range of YOUTUBE_RANGES) dashboardCache.delete(`${handle}:${range}`);
  crystalCache.delete(handle);
  warmedHandles.delete(handle);
}

// One cache discipline for every aggregate consumer (dashboard pages,
// crystal.json, /compare, the warm sweep): entries are keyed on the table
// counts with a shared TTL. Callers that already computed counts pass them
// in so a request never runs the COUNT aggregates twice.
function cachedDashboardFor(registry: UserRegistry, user: User, range: YoutubeRange, repository = registry.repositoryFor(user), validity = validityFor(repository.youtubeCounts(), processingFor(repository))): YoutubeDashboardData {
  const now = Date.now();
  const id = `${user.handle}:${range}`;
  let entry = dashboardCache.get(id);
  if (!entry || entry.key !== validity || now - entry.at > CACHE_TTL_MS) {
    entry = { key: validity, at: now, data: repository.youtubeDashboard(range) };
    dashboardCache.set(id, entry);
  }
  return entry.data;
}

function cachedCrystalFor(registry: UserRegistry, user: User, repository = registry.repositoryFor(user), validity = validityFor(repository.youtubeCounts(), processingFor(repository))): YoutubeCrystal {
  const now = Date.now();
  let entry = crystalCache.get(user.handle);
  if (!entry || entry.key !== validity || now - entry.at > CACHE_TTL_MS) {
    entry = { key: validity, at: now, crystal: buildYoutubeCrystal(repository, user) };
    crystalCache.set(user.handle, entry);
  }
  return entry.crystal;
}

interface AppServices {
  loadTagLists: () => Promise<TagListSnapshot>;
}

export function createApp(registry: UserRegistry, services: Partial<AppServices> = {}): Hono {
  const app = new Hono();
  const loadTagLists = services.loadTagLists ?? fetchTagLists;
  app.use('*', securityHeaders(true));
  const accountStateFor = (user: User, state: AccountPageState = {}): AccountPageState => ({
    extensionVersion: extensionVersion(),
    processing: processingFor(registry.repositoryFor(user)),
    matchingDimensions: registry.matchingDimensionsFor(user),
    ...state,
  });
  const onboardingStateFor = (user: User): GuidedOnboardingState => {
    const repository = registry.repositoryFor(user);
    return guidedOnboardingState({
      user,
      watchEvents: repository.youtubeCounts().watches,
      processing: processingFor(repository),
      dimensions: registry.matchingDimensionsFor(user),
      matchingCrystal: registry.matchingCrystalFor(user.handle),
      latestScan: repository.youtubeProgressImports(1)[0] ?? null,
    });
  };
  const onboardingDestinationFor = (user: User): string =>
    onboardingStateFor(user).step === 'complete' ? `/${user.handle}` : '/onboarding';

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

  function siteNav(c: Context, lang: Lang, active?: PrimaryNavActive): ShellNavItem[] {
    const me = sessionUser(c);
    return primaryNav(lang, {
      active,
      ...(me ? { dashboardHref: `/${me.handle}` } : { exampleHref: `/${DEFAULT_HANDLE}` }),
      languageHref: langToggle(c, lang).href,
    });
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
  function dashboardKeyAccess(c: Context, user: User): boolean {
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

  function dashboardAccess(c: Context, user: User): boolean {
    if (user.dashboardPublic) return true;
    if (sessionUser(c)?.id === user.id) return true;
    return dashboardKeyAccess(c, user);
  }

  async function dashboardResponse(
    c: Context,
    user: User,
    profilePath: string,
    page: YoutubeDashboardPageKind = 'overview',
  ) {
    const lang = langOf(c);
    const repository = registry.repositoryFor(user);
    const counts = repository.youtubeCounts();
    const processing = processingFor(repository);
    const validity = validityFor(counts, processing);
    const range = requestedRange(c.req.query('range'));
    const requestedShortForm = c.req.query('shorts');
    const shortFormVariant = requestedShortForm === 'stacked'
      || requestedShortForm === 'compare'
      || requestedShortForm === 'heatmap'
      || requestedShortForm === 'absolute'
      || requestedShortForm === 'dual'
      ? requestedShortForm : undefined;
    const data = cachedDashboardFor(registry, user, range, repository, validity);
    const hasData = counts.watches > 0;
    const me = sessionUser(c);
    const viewerOwns = me?.id === user.id;
    // Public visitors see only aggregates. A signed-in owner or someone with
    // the dashboard key may also see individual recent watches.
    const showRecent = viewerOwns || dashboardKeyAccess(c, user);
    const crystalHtml = page === 'insights' && hasData
      ? shiftsSection(cachedCrystalFor(registry, user, repository, validity), lang) : '';
    let leaningsHtml = '';
    if (page === 'insights' && hasData) {
      try {
        const snapshot = await loadTagLists();
        const tagLean = computeTagLean(
          range,
          repository.youtubeChannelTotals(range),
          snapshot,
        );
        const contributions = registry.listReferencePopulationUsers().flatMap((contributor) => {
          const contributorRepository = registry.repositoryFor(contributor);
          const dataUpdatedAt = contributorRepository.youtubeReferenceDataUpdatedAt();
          if (!dataUpdatedAt) return [];
          return [{
            subjectId: contributor.id,
            dataUpdatedAt,
            data: contributor.id === user.id
              ? tagLean
              : computeTagLean(
                range,
                contributorRepository.youtubeChannelTotals(range),
                snapshot,
              ),
          }];
        });
        leaningsHtml = tagLeanSection(
          tagLean,
          lang,
          buildReferencePopulation(tagLean, contributions),
        );
      } catch (error) {
        console.warn('channel classifications unavailable:',
          error instanceof Error ? error.message : 'unknown error');
        leaningsHtml = `<section class="section"><div class="section-head"><h2>${messages(lang).tagLeanTitle}</h2></div><p class="muted">${messages(lang).tagLeanUnavailable}</p></section>`;
      }
    }
    const history = page === 'history' && showRecent
      ? repository.youtubeWatchHistory(range, 100) : undefined;
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
    const suffix: Record<YoutubeDashboardPageKind, string> = {
      overview: '', insights: '/insights', history: '/history', recap: '/recap',
    };
    const pagePath = `${profilePath}${suffix[page]}`;
    return c.html(youtubeDashboardPage(user.displayName, data, requestedSort(c.req.query('sort')), {
      basePath: pagePath,
      profilePath,
      page,
      lang,
      nav: siteNav(c, lang, viewerOwns
        ? 'dashboard'
        : !me && user.handle === DEFAULT_HANDLE ? 'example' : undefined),
      setupHtml: showSetup ? dashboardSetupSection(user, hasData, lang) : '',
      // Every visitor, not just the owner: a public reader deserves to know
      // the figures are still settling.
      processingHtml: hasData ? processingNotice(processing, lang) : '',
      insightsHtml: crystalHtml + leaningsHtml,
      history,
      showRecent,
      shortFormVariant,
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
    return c.html(shell(t.landingDocTitle, body, siteNav(c, lang), '', lang, '/'));
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

  // The Open Graph card (1200×630 PNG — scrapers don't take SVG), referenced
  // by every page's og:image.
  let ogImage: Buffer | null = null;
  app.get('/og.png', (c) => {
    if (ogImage === null) {
      ogImage = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'og.png'));
    }
    c.header('Content-Type', 'image/png');
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(ogImage.buffer.slice(ogImage.byteOffset, ogImage.byteOffset + ogImage.byteLength) as ArrayBuffer);
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
        return c.redirect(identity.next || onboardingDestinationFor(existing));
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
    if (me) return c.redirect(onboardingDestinationFor(me));
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
        return c.redirect(onboardingDestinationFor(linked));
      } catch (error) {
        return c.html(signupCompletePage(pageInput, error instanceof Error ? error.message : String(error), lang), 409);
      }
    }

    if (!config.signupEnabled) return c.html(signupStartPage(t.errSignupsDisabled, lang), 403);
    if (registry.listUsers().length >= config.maxUsers) {
      return c.html(signupCompletePage(pageInput, t.errSignupCapacity, lang), 503);
    }
    if (!signupAllowed(clientIp(c))) {
      return c.html(signupCompletePage(pageInput, t.errTooManySignups, lang), 429);
    }
    const handle = String(form.handle ?? '').trim().toLocaleLowerCase('en-US');
    const displayName = String(form.displayName ?? '').trim().slice(0, 80);
    if (!displayName) return c.html(signupCompletePage(pageInput, t.errNameRequired, lang), 400);
    try {
      if (registry.userByGoogleSub(pending.sub)) {
        return c.html(signupStartPage(t.errGoogleTaken, lang), 409);
      }
      if (registry.userByHandle(handle)) {
        return c.html(signupCompletePage(pageInput, t.errHandleTaken(handle), lang), 409);
      }
      const created = registry.createUser(handle, displayName, {
        googleSub: pending.sub, googleEmail: pending.email,
      });
      finish(created);
      c.header('Cache-Control', 'no-store');
      return c.redirect('/onboarding');
    } catch (error) {
      return c.html(signupCompletePage(pageInput, error instanceof Error ? error.message : String(error), lang), 400);
    }
  });

  app.get('/onboarding', (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/auth/google?next=%2Fonboarding');
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    return c.html(guidedOnboardingPage(me, onboardingStateFor(me), langOf(c)));
  });

  app.post('/onboarding/interests', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/auth/google?next=%2Fonboarding');
    const state = onboardingStateFor(me);
    if (state.step !== 'interests') return c.text('Onboarding step is no longer available', 409);
    const form = await c.req.parseBody({ all: true });
    const values = (value: string | File | Array<string | File> | undefined): string[] =>
      (Array.isArray(value) ? value : value == null ? [] : [value])
        .filter((item): item is string => typeof item === 'string');
    const selected = values(form.selectedTopicKeys);
    const suggested = state.dimensions.suggestedTopicKeys;
    const allowed = new Set(suggested);
    if (new Set(selected).size !== selected.length || selected.some((key) => !allowed.has(key))) {
      return c.text('Matching interests are invalid', 400);
    }
    try {
      registry.setMatchingDimensions(
        me.handle,
        Number(form.taxonomyVersion),
        selected,
        suggested.filter((key) => !selected.includes(key)),
      );
      return c.redirect('/onboarding');
    } catch {
      return c.text('Matching interests changed. Reload onboarding and try again.', 409);
    }
  });

  app.post('/onboarding/finish', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/auth/google?next=%2Fonboarding');
    if (onboardingStateFor(me).step !== 'consent') {
      return c.text('Onboarding step is no longer available', 409);
    }
    const form = await c.req.parseBody();
    const choice = String(form.choice ?? '');
    if (choice !== 'join' && choice !== 'private') return c.text('Choose a matching option', 400);
    try {
      const updated = registry.completeOnboarding(
        me.handle,
        choice === 'join',
        String(form.matchingDisclosure ?? '') as MatchingDisclosureLevel,
      );
      return c.redirect(choice === 'join' ? '/matches' : `/${updated.handle}`);
    } catch {
      return c.text('Matching choice is invalid', 400);
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
    c.header('Cache-Control', 'no-store');
    return c.html(accountPage(me, accountStateFor(me), langOf(c)));
  });

  const taxonomyAuditFor = (user: User) => {
    const repository = registry.repositoryFor(user);
    const runs = repository.youtubeTaxonomyRuns();
    return {
      readiness: repository.youtubePersonalTaxonomyReadiness(),
      canPrepare: !runs.some((run) =>
        run.definitionVersion === PERSONAL_TAXONOMY_DEFINITION_VERSION
        && ['candidate', 'ready', 'active'].includes(run.status)),
      runs: runs.map((run) => ({
        run,
        distribution: repository.youtubePersonalTaxonomyDistribution(run.taxonomyVersion),
        evidence: run.definitionVersion === PERSONAL_TAXONOMY_DEFINITION_VERSION
          ? repository.youtubePersonalTaxonomyEvidence(run.taxonomyVersion, 2) : [],
      })),
      activations: repository.youtubeTaxonomyActivations(),
    };
  };

  app.get('/account/taxonomy', (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    return c.html(personalTaxonomyAuditPage(taxonomyAuditFor(me), langOf(c), '', `/${me.handle}`));
  });

  app.post('/account/taxonomy/prepare', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const lang = langOf(c);
    const form = await c.req.parseBody();
    const renderError = (message: string, status: 400 | 503 = 400) => {
      c.header('Cache-Control', 'no-store');
      c.header('X-Robots-Tag', 'noindex');
      return c.html(personalTaxonomyAuditPage(taxonomyAuditFor(me), lang, message, `/${me.handle}`), status);
    };
    if (form.confirmed !== '1') {
      return renderError(lang === 'zh' ? '必須先確認建立候選版本' : 'Candidate confirmation is required');
    }
    const repository = registry.repositoryFor(me);
    const before = repository.youtubeTaxonomyRuns();
    if (before.some((run) => run.definitionVersion === PERSONAL_TAXONOMY_DEFINITION_VERSION
      && ['candidate', 'ready', 'active'].includes(run.status))) {
      return renderError(lang === 'zh' ? '已有進行中或可用的 v2 版本' : 'A current v2 run already exists');
    }
    try {
      const previousVersions = new Set(before.map((run) => run.taxonomyVersion));
      await ensureYoutubeTaxonomy(repository, true);
      const created = repository.youtubeTaxonomyRuns().find((run) =>
        !previousVersions.has(run.taxonomyVersion)
        && run.definitionVersion === PERSONAL_TAXONOMY_DEFINITION_VERSION);
      if (!created) {
        const readiness = repository.youtubePersonalTaxonomyReadiness();
        return renderError(readiness.ready
          ? (lang === 'zh' ? '此部署未啟用 AI 分類' : 'AI classification is not enabled on this deployment')
          : (lang === 'zh' ? 'Metadata 尚未達到建立候選版本的門檻' : 'Metadata is not ready for a candidate yet'), 503);
      }
      evictUserCaches(me.handle);
      return c.redirect('/account/taxonomy');
    } catch (caught) {
      return renderError(caught instanceof Error ? caught.message : 'Candidate creation failed');
    }
  });

  app.post('/account/taxonomy/:version/activate', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const lang = langOf(c);
    const version = Number(c.req.param('version'));
    const form = await c.req.parseBody();
    const error = lang === 'zh' ? '必須先確認人工審核' : 'Manual review confirmation is required';
    if (!Number.isSafeInteger(version) || version < 1 || form.reviewed !== '1') {
      c.header('Cache-Control', 'no-store');
      c.header('X-Robots-Tag', 'noindex');
      return c.html(personalTaxonomyAuditPage(taxonomyAuditFor(me), lang, error, `/${me.handle}`), 400);
    }
    try {
      registry.repositoryFor(me).activatePersonalTaxonomy(version);
      evictUserCaches(me.handle);
      return c.redirect('/account/taxonomy');
    } catch (caught) {
      c.header('Cache-Control', 'no-store');
      c.header('X-Robots-Tag', 'noindex');
      const message = caught instanceof Error ? caught.message : 'Taxonomy activation failed';
      return c.html(personalTaxonomyAuditPage(taxonomyAuditFor(me), lang, message, `/${me.handle}`), 400);
    }
  });

  app.get('/matches', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/auth/google?next=%2Fmatches');
    const lang = langOf(c);
    const inbox = registry.matchingInboxFor(me);
    const provisional = processingFor(registry.repositoryFor(me)).pending > 0;
    const respond = (
      state: Parameters<typeof matchesPage>[2],
      status: 200 | 403 = 200,
      recommendations: CohortRecommendations = { topics: [], channels: [] },
    ) => {
      c.header('Cache-Control', 'no-store');
      c.header('X-Robots-Tag', 'noindex');
      return c.html(matchesPage(
        me.displayName,
        `/${me.handle}`,
        state,
        lang,
        inbox,
        provisional,
        recommendations,
        langToggle(c, lang).href,
      ), status);
    };
    if (!me.matchingOptIn) return respond({ kind: 'opt_in_required' }, 403);
    const crystal = registry.matchingCrystalFor(me.handle);
    if (!crystal || !registryCrystalEligible(crystal)) return respond({ kind: 'data_pending' });
    const viewer: MatchableCrystal = {
      userId: me.id,
      handle: me.handle,
      displayName: me.displayName,
      disclosureLevel: me.matchingDisclosure,
      crystal,
      dimensions: registry.matchingDimensionsFor(me),
    };
    const pool = registry.listMatchableCrystals(MATCHING_CANDIDATE_POOL_LIMIT + 1);
    let channelPolicy: CohortChannelPolicy | undefined;
    if (pool.length >= 4) {
      try {
        const snapshot = await loadTagLists();
        channelPolicy = cohortChannelPolicy(
          snapshot.lists,
          registry.repositoryFor(me).youtubeChannelTotals('90d'),
        );
      } catch (error) {
        console.warn('cohort channel recommendations unavailable:',
          error instanceof Error ? error.message : 'unknown error');
      }
    }
    const recommendations = cohortRecommendations(viewer, pool, channelPolicy);
    const cards = rankedMatchingCandidateCards(
      viewer,
      registry.listMatchingCandidatesFor(me, MATCHING_CANDIDATE_POOL_LIMIT),
    );
    if (!cards.length) return respond({ kind: 'empty' }, 200, recommendations);
    const batch = matchingCandidateBatch(cards, Number(c.req.query('page') ?? 1));
    return respond({ kind: 'ready', batch: {
      ...batch,
      cards: batch.cards.map((card) => ({
        ...card,
        actionToken: registry.issueMatchActionToken(me, card.candidateUserId, card.disclosure.topics),
      })),
    } }, 200, recommendations);
  });

  const matchingActionError = (c: Context) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    return c.text(messages(langOf(c)).matchesActionInvalid, 400);
  };

  app.post('/matches/request', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/auth/google?next=%2Fmatches');
    const form = await c.req.parseBody();
    try {
      registry.createMatchRequest(me, String(form.actionToken ?? ''));
      return c.redirect('/matches');
    } catch {
      return matchingActionError(c);
    }
  });

  app.post('/matches/respond', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/auth/google?next=%2Fmatches');
    const form = await c.req.parseBody();
    const response = String(form.response ?? '');
    if (response !== 'accept' && response !== 'decline') return matchingActionError(c);
    try {
      registry.respondToMatchRequest(me, String(form.requestToken ?? ''), response);
      return c.redirect('/matches');
    } catch {
      return matchingActionError(c);
    }
  });

  app.post('/matches/withdraw', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/auth/google?next=%2Fmatches');
    const form = await c.req.parseBody();
    try {
      registry.withdrawMatchRequest(me, String(form.requestToken ?? ''));
      return c.redirect('/matches');
    } catch {
      return matchingActionError(c);
    }
  });

  // Token recovery: rotating invalidates both old tokens and shows the new
  // pair exactly once, same show-once rule as signup.
  app.post('/account/rotate', (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const rotated = registry.rotateTokens(me.handle);
    c.header('Cache-Control', 'no-store');
    return c.html(accountPage(me, accountStateFor(me, { rotated }), langOf(c)));
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
      return c.html(accountPage(me, accountStateFor(me, {
        error: error instanceof Error ? error.message : String(error),
      }), langOf(c)), 400);
    }
  });

  app.post('/account/visibility', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const form = await c.req.parseBody();
    registry.setDashboardPublic(me.handle, form.dashboardPublic === '1');
    return c.redirect('/account');
  });

  app.post('/account/matching', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const form = await c.req.parseBody();
    try {
      registry.setMatchingPreferences(
        me.handle,
        form.matchingOptIn === '1',
        String(form.matchingDisclosure ?? '') as MatchingDisclosureLevel,
      );
      return c.redirect('/account');
    } catch (error) {
      const current = registry.userByHandle(me.handle) ?? me;
      return c.html(accountPage(current, accountStateFor(current, {
        error: error instanceof Error ? error.message : String(error),
      }), langOf(c)), 400);
    }
  });

  app.post('/account/reference-population', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const form = await c.req.parseBody();
    registry.setReferenceOptIn(me.handle, form.referenceOptIn === '1');
    return c.redirect('/account');
  });

  app.post('/account/match-profile', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const form = await c.req.parseBody();
    registry.setMatchingProfile(
      me.handle,
      String(form.matchingIntroduction ?? ''),
      String(form.matchingContact ?? ''),
    );
    return c.redirect('/account');
  });

  app.post('/account/matching-dimensions', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const current = registry.matchingDimensionsFor(me);
    const values = (value: string | File | Array<string | File> | undefined): string[] =>
      (Array.isArray(value) ? value : value == null ? [] : [value])
        .filter((item): item is string => typeof item === 'string');
    try {
      if (current.status === 'pending') {
        throw new Error('Matching interests are not ready; sync more history and wait for processing to finish');
      }
      const form = await c.req.parseBody({ all: true });
      registry.setMatchingDimensions(
        me.handle,
        Number(form.taxonomyVersion),
        values(form.selectedTopicKeys),
        values(form.excludedTopicKeys),
      );
      return c.redirect('/account');
    } catch (error) {
      return c.html(accountPage(me, accountStateFor(me, {
        error: error instanceof Error ? error.message : String(error),
      }), langOf(c)), 400);
    }
  });

  // Browser-friendly Takeout import: same parser and idempotent ingest as
  // the API endpoint, but authenticated by the login session. It lives behind
  // a progressive-disclosure panel on /account so the extension remains the
  // uncomplicated default path.
  app.post('/account/takeout', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const lang = langOf(c);
    const t = messages(lang);
    const renderError = (error: string, status: 400 | 413 | 507 = 400) => {
      c.header('Cache-Control', 'no-store');
      return c.html(accountPage(me, accountStateFor(me, { takeoutError: error }), lang), status);
    };
    if (registry.databaseBytesFor(me) >= config.maxUserDatabaseBytes) {
      return renderError(t.accountTakeoutStorageLimit, 507);
    }
    const contentLength = Number(c.req.header('content-length') ?? 0);
    // Multipart framing adds a little overhead around the ZIP itself. Reject
    // obviously oversized bodies before asking the runtime to buffer them.
    if (contentLength > MAX_YOUTUBE_ARCHIVE_BYTES + 1024 * 1024) {
      return renderError(t.accountTakeoutTooLarge, 413);
    }
    if (!c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
      return renderError(t.accountTakeoutChooseZip);
    }
    try {
      const form = await c.req.formData();
      const upload = form.get('takeout');
      if (!upload || typeof upload === 'string' || !upload.name.toLowerCase().endsWith('.zip')) {
        return renderError(t.accountTakeoutChooseZip);
      }
      if (upload.size > MAX_YOUTUBE_ARCHIVE_BYTES) {
        return renderError(t.accountTakeoutTooLarge, 413);
      }
      const dataKey = registry.dataKeyFor(me);
      if (!dataKey) return renderError(t.accountTakeoutUnavailable);
      const archive = new Uint8Array(await upload.arrayBuffer());
      const parsed = parseYoutubeArchive(archive, dataKey, 'takeout');
      const repository = registry.repositoryFor(me);
      const result = repository.ingestYoutubeArchive(parsed);
      registry.markCrystalDirty(me);
      evictUserCaches(me.handle);
      c.header('Cache-Control', 'no-store');
      return c.html(accountPage(me, accountStateFor(me, {
        takeoutResult: result,
        processing: processingFor(repository),
      }), lang));
    } catch (error) {
      return renderError(error instanceof Error ? error.message : String(error));
    }
  });

  app.post('/account/export', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.text('Sign in required', 401);
    const lang = langOf(c);
    const t = messages(lang);
    const form = await c.req.parseBody();
    if (form.confirmExport !== '1') {
      c.header('Cache-Control', 'no-store');
      return c.html(accountPage(me, accountStateFor(me, {
        error: t.accountExportConfirmError,
      }), lang), 400);
    }
    const dataKey = registry.dataKeyFor(me);
    if (!dataKey) {
      c.header('Cache-Control', 'no-store');
      return c.html(accountPage(me, accountStateFor(me, {
        error: t.accountExportUnavailable,
      }), lang), 503);
    }
    const repository = registry.repositoryFor(me);
    const download = userDataExport({
      repository,
      dataKey,
      account: registry.portableAccountDataFor(me),
      personalCrystal: cachedCrystalFor(registry, me, repository),
    });
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="${download.filename}"`);
    return c.body(download.stream);
  });

  // Self-serve deletion: session plus retyping the handle. deleteUser refuses
  // the instance owner, which we surface as a friendly error.
  app.post('/account/delete', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const lang = langOf(c);
    const t = messages(lang);
    const form = await c.req.parseBody();
    if (String(form.confirmHandle ?? '').trim() !== me.handle) {
      return c.html(accountPage(me, accountStateFor(me, { error: t.errDeleteConfirm }), lang), 400);
    }
    if (me.handle === DEFAULT_HANDLE) {
      return c.html(accountPage(me, accountStateFor(me, { error: t.errOwnerDelete }), lang), 400);
    }
    try {
      registry.deleteUser(me.handle);
    } catch (error) {
      return c.html(accountPage(me, accountStateFor(me, {
        error: error instanceof Error ? error.message : String(error),
      }), lang), 500);
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
    return c.html(shell(t.privacyTitle, body, siteNav(c, lang), '', lang, '/privacy'));
  });

  app.get('/robots.txt', (c) => {
    return c.text(`User-agent: *\nDisallow: /compare\nDisallow: /account\nDisallow: /signup\nDisallow: /auth/\nSitemap: ${config.publicBaseUrl}/sitemap.xml\n`);
  });

  // The indexable surface: the landing page, privacy, and every PUBLIC
  // dashboard with its leanings subpage. Private dashboards are keyed,
  // noindexed, and never listed here.
  app.get('/sitemap.xml', (c) => {
    const paths = ['/', '/privacy'];
    for (const user of registry.listUsers()) {
      if (!user.dashboardPublic) continue;
      const root = `/${user.handle}`;
      paths.push(root, `${root}/insights`, `${root}/history`, `${root}/recap`);
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((path) => `  <url><loc>${html(config.publicBaseUrl + path)}</loc></url>`).join('\n')}\n</urlset>\n`;
    c.header('Content-Type', 'application/xml');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.body(body);
  });

  // Installed extensions poll this to learn a newer build is available.
  app.get('/extension-version.json', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ version: extensionVersion() });
  });

  app.get('/extension.zip', (c) => {
    const zip = buildExtensionZip();
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="${extensionDownloadName()}"`);
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
    const lang = langOf(c);
    const aHandle = c.req.query('a') ?? '';
    const bHandle = c.req.query('b') ?? '';
    const a = registry.userByHandle(aHandle);
    const b = registry.userByHandle(bHandle);
    if (!a || !b || a.handle === b.handle) {
      const body = `<section style="margin:16vh auto 10vh;max-width:560px;text-align:center">
        <h1 style="letter-spacing:-.03em;margin:0 0 10px">/compare</h1>
        <p style="color:var(--ink-2)"><code>/compare?a=&lt;handle&gt;&amp;b=&lt;handle&gt;</code></p>
      </section>`;
      return c.html(shell('compare', body, siteNav(c, lang), '', lang, '/compare'), 400);
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
    return c.html(comparePage(comparison, `/${a.handle}`, lang, siteNav(c, lang)));
  });

  app.get('/u/:handle/summary.json', (c) => {
    const user = registry.userByHandle(c.req.param('handle'));
    if (!user || !dashboardAccess(c, user)) return c.json({ error: 'not found' }, 404);
    const data = registry.repositoryFor(user).youtubeDashboard(requestedRange(c.req.query('range')));
    return c.json({ ...data, recent: undefined });
  });

  app.get('/api/youtube/summary.json', (c) => {
    const user = registry.ensureDefaultUser();
    if (!dashboardAccess(c, user)) return c.json({ error: 'not found' }, 404);
    const data = registry.repositoryFor(user).youtubeDashboard(requestedRange(c.req.query('range')));
    return c.json({ ...data, recent: undefined });
  });

  app.get('/api/youtube/recent.json', (c) => {
    const user = registry.ensureDefaultUser();
    if (!dashboardAccess(c, user)) return c.json({ error: 'not found' }, 404);
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

  // Production readiness is stricter than liveness: every user database must
  // open, required signup config must exist, and scheduled jobs must either
  // be live with a fresh heartbeat or have completed recently. External
  // monitoring should probe this endpoint.
  app.get('/readyz', (c) => {
    const now = Date.now();
    const worker = readOpsStatus<WorkerOpsStatus>('worker');
    const backup = readOpsStatus<{ lastCompletedAt?: string; lastError?: string }>('backup');
    const fresh = (iso: string | undefined, maxAgeMs: number) =>
      Boolean(iso && Number.isFinite(Date.parse(iso)) && now - Date.parse(iso) <= maxAgeMs);
    let databaseFailures = 0;
    const users = registry.listUsers();
    for (const user of users) {
      try {
        registry.repositoryFor(user).youtubeCounts();
      } catch {
        databaseFailures++;
      }
    }
    const checks = {
      config: Boolean(config.youtube.privateDataKey && (!config.signupEnabled || googleLoginConfigured())),
      databases: databaseFailures === 0,
      worker: workerOpsReady(worker, now),
      backup: fresh(backup?.lastCompletedAt, (config.backup.intervalHours + 2) * 3600_000)
        && !backup?.lastError,
    };
    const ready = Object.values(checks).every(Boolean);
    return c.json({
      status: ready ? 'ready' : 'not_ready',
      checks,
      users: { total: users.length, databaseFailures },
      worker: {
        running: worker?.running ?? false,
        heartbeatAt: worker?.heartbeatAt ?? null,
        lastCompletedAt: worker?.lastCompletedAt ?? null,
        failedUsers: worker?.failedUsers ?? null,
      },
      backup: { lastCompletedAt: backup?.lastCompletedAt ?? null },
    }, ready ? 200 : 503);
  });

  function notFoundPage(c: Context) {
    const lang = langOf(c);
    const t = messages(lang);
    const body = `<section style="margin:16vh auto 10vh;max-width:520px;text-align:center">
      <h1 style="font-size:72px;letter-spacing:-.05em;line-height:1;margin:0 0 12px">404</h1>
      <p style="color:var(--ink-2)">${t.notFoundPara}</p>
      <p style="margin-top:26px"><a href="/" style="background:var(--accent);border-radius:999px;color:#fff;font-size:14px;font-weight:700;padding:11px 20px;text-decoration:none">${t.navHome}</a></p>
    </section>`;
    return c.html(shell(t.notFoundTitle, body, siteNav(c, lang), '', lang), 404);
  }

  const profilePage = (page: YoutubeDashboardPageKind) => (c: Context) => {
    const user = registry.userByHandle(c.req.param('handle') ?? '');
    if (!user || !dashboardAccess(c, user)) return notFoundPage(c);
    return dashboardResponse(c, user, `/${user.handle}`, page);
  };

  // Four primary profile pages. Each is a single full-width vertical story.
  app.get('/:handle/insights', profilePage('insights'));
  app.get('/:handle/history', profilePage('history'));
  app.get('/:handle/recap', profilePage('recap'));

  // Former fifth page: tags now render inside Insights. Keep old bookmarks
  // working, and drop a one-time dashboard key from the redirected URL after
  // dashboardAccess has persisted it in the HttpOnly cookie.
  app.get('/:handle/tags', (c) => {
    const user = registry.userByHandle(c.req.param('handle'));
    if (!user || !dashboardAccess(c, user)) return notFoundPage(c);
    const url = new URL(c.req.url);
    url.searchParams.delete('key');
    return c.redirect(`/${user.handle}/insights${url.search}`, 301);
  });

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
      const validity = validityFor(counts, processingFor(repository));
      for (const range of YOUTUBE_RANGES) {
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
