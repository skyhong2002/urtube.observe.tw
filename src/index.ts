import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { completeGoogleLogin, googleLoginConfigured, googleLoginUrl, suggestedHandle } from './auth.js';
import { AvatarService, type AvatarImage } from './avatars.js';
import { config } from './config.js';
import { settings as matchingV3Settings } from './matching-v3/model.js';
import { matchingRoutes } from './matching-v3/routes.js';
import type { Compute } from './matching-v3/compute.js';
import type { Settings as MatchingSettings } from './matching-v3/model.js';
import type { Repository } from './data/database.js';
import { cachedRead, clearReadCaches } from './data/read-cache.js';
import { userDataExport } from './data/user-export.js';
import { buildExtensionZip, extensionDownloadName, extensionVersion } from './extension-bundle.js';
import { comparePage, shiftsSection } from './output/crystal.js';
import { messages, pickLang, type Lang } from './output/i18n.js';
import { matchesPage, matchingCandidatePage, friendshipActions, candidateCard, type ActionableMatchingCandidateCard } from './output/matches.js';
import { channelPreview } from './output/channel-preview.js';
import { memberProfilePage } from './output/member-profile.js';
import { registryMatchingCrystal } from './youtube/registry-crystal.js';
import { resolveMatchingDimensions } from './youtube/dimensions.js';
import {
  YOUTUBE_CHANNEL_ID_PATTERN,
  channelPage,
  channelDirectoryPage,
  channelPageRange,
  channelPageSort,
  type ChannelCommunityVideo,
  type ChannelMemberRow,
  type ChannelPageRange,
} from './output/channel.js';
import { landingContent } from './output/landing.js';
import { communityStatsProvider } from './youtube/community.js';
import {
  accountPage, dashboardSetupSection, extensionSetupPage, guidedOnboardingPage,
  signupCompletePage, signupStartPage,
  type AccountPageState,
} from './output/onboarding.js';
import { guidedOnboardingState, type GuidedOnboardingState } from './onboarding-flow.js';
import { buildYoutubeCrystal, compareCrystals, type YoutubeCrystal } from './youtube/crystal.js';
import { ensureYoutubeTaxonomy } from './youtube/ai.js';
import { fetchYoutubeChannelMetadata } from './youtube/metadata.js';
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
import {
  COMPARISON_RANGES,
  compareWatchProfiles,
  comparisonRange,
  type ComparisonRange,
} from './youtube/comparison.js';
import { MATCHING_TAXONOMY } from './youtube/matching.js';
import type { TagListSnapshot } from './youtube/taglists.js';
import {
  YOUTUBE_RANGES,
  type YoutubeChannelDetail,
  type YoutubeChannelMetadata,
  type YoutubeChannelSummary,
  type YoutubeComparisonProfile,
  type YoutubeDashboardData,
  type YoutubeRange,
} from './youtube/types.js';
import { PERSONAL_TAXONOMY_DEFINITION_VERSION } from './youtube/personal-taxonomy.js';

// A year is the default view everywhere; shorter ranges are one click away.
export const DEFAULT_YOUTUBE_RANGE: YoutubeRange = '365d';

function requestedRange(value: string | undefined): YoutubeRange {
  return YOUTUBE_RANGES.includes(value as YoutubeRange) ? value as YoutubeRange : DEFAULT_YOUTUBE_RANGE;
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

// Shared revision-aware data cache. Every route still checks the current
// session, visibility, membership and consent before reading cached data.
// Fill aggregates on demand: speculative range sweeps run synchronous SQLite
// queries and block unrelated requests, even if they yield between ranges.
function countsFor(repository: Repository) {
  return cachedRead(repository, 'counts', () => repository.youtubeCounts());
}
function processingFor(repository: Repository): YoutubeProcessingStatus {
  // ETA and stale-worker status also depend on the clock.
  return cachedRead(repository, 'processing', () =>
    describeYoutubeProcessing(repository.youtubeProcessingCounts(), youtubeProcessingCapabilities()), 5000);
}
function cachedDashboardFor(registry: UserRegistry, user: User, range: YoutubeRange, repository = registry.repositoryFor(user), includeInsights: boolean | 'overview' = false): YoutubeDashboardData {
  return cachedRead(repository, `dashboard:${range}:${includeInsights}`, () => repository.youtubeDashboard(range, new Date(), includeInsights));
}
function cachedComparisonProfileFor(registry: UserRegistry, user: User, range: ComparisonRange, repository = registry.repositoryFor(user)): YoutubeComparisonProfile {
  return cachedRead(repository, `comparison:${range}`, () => repository.youtubeComparisonProfile(MATCHING_TAXONOMY.version, range));
}
function cachedChannelDetailFor(registry: UserRegistry, user: User, channelId: string, range: ChannelPageRange, repository = registry.repositoryFor(user)): YoutubeChannelDetail {
  return cachedRead(repository, `channel:${channelId}:${range}`, () => repository.youtubeChannelDetail(channelId, range));
}
function cachedChannelTotalsFor(registry: UserRegistry, user: User, range: YoutubeRange): YoutubeChannelSummary[] {
  const repository = registry.repositoryFor(user);
  return cachedRead(repository, `channels:${range}`, () => repository.youtubeChannelTotals(range));
}
function cachedCrystalFor(registry: UserRegistry, user: User, repository = registry.repositoryFor(user)): YoutubeCrystal {
  return cachedRead(repository, `crystal:${user.handle}:${user.displayName}`, () => buildYoutubeCrystal(repository, user));
}

interface AppServices {
  matchingV3: { settings: MatchingSettings; compute: Compute };
  loadTagLists: () => Promise<TagListSnapshot>;
  avatarService: Pick<AvatarService, 'avatarFor'>;
  loadChannelMetadata: (channelId: string) => Promise<YoutubeChannelMetadata | null>;
}

export function createApp(registry: UserRegistry, services: Partial<AppServices> = {}): Hono {
  const app = new Hono();
  const loadTagLists = services.loadTagLists ?? fetchTagLists;
  const avatarService = services.avatarService ?? new AvatarService();
  const loadChannelMetadata = services.loadChannelMetadata ?? (async (channelId: string) => {
    if (!config.youtube.apiKey) return null;
    const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(4000) });
    return (await fetchYoutubeChannelMetadata([channelId], config.youtube.apiKey, boundedFetch))[0] ?? null;
  });
  // Share concurrent lookups across viewers; back off after upstream failures.
  const channelMetadataLookups = new Map<string, { until: number; result: Promise<YoutubeChannelMetadata | null> }>();
  const refreshChannelMetadata = async (channelId: string) => {
    const now = Date.now();
    const existing = channelMetadataLookups.get(channelId);
    if (existing && existing.until > now) return existing.result;
    const entry = { until: now + 300_000, result: Promise.resolve(null) as Promise<YoutubeChannelMetadata | null> };
    entry.result = loadChannelMetadata(channelId).then((metadata) => {
      if (!metadata || metadata.channelId !== channelId) return null;
      entry.until = Date.now() + 86400_000;
      return { ...metadata, statisticsFetchedAt: new Date().toISOString() };
    }).catch(() => null);
    if (channelMetadataLookups.size >= 128) channelMetadataLookups.delete(channelMetadataLookups.keys().next().value!);
    channelMetadataLookups.set(channelId, entry);
    return entry.result;
  };
  app.use('*', securityHeaders(true));
  const v3 = services.matchingV3?.settings ?? matchingV3Settings();
  if (v3.enabled) app.route('/', matchingRoutes(registry, v3, config.publicBaseUrl, services.matchingV3?.compute, (viewer, target, result, lang) => {
    const card = blendCard(viewer, target);
    if (viewer.matchingOptIn && target.matchingOptIn) card.actionToken = registry.issueMatchActionToken(viewer, target.id, card.disclosure.topics);
    card.topicMatch = { score: result.score, provisional: result.provisional, reasons: result.reasons.map(reason => reason.text), detailsVisible: result.detailsVisible };
    return candidateCard(card, viewer.handle, lang);
  }));
  const accountStateFor = (user: User, state: AccountPageState = {}): AccountPageState => ({
    extensionVersion: extensionVersion(),
    processing: processingFor(registry.repositoryFor(user)),
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

  function mutualFriends(viewer: User | null, target: User): boolean {
    return Boolean(viewer?.matchingOptIn && target.matchingOptIn
      && registry.matchingRelationshipFor(viewer, target.id).status === 'connected');
  }

  function privateDashboardAccess(c: Context, user: User): boolean {
    return sessionUser(c)?.id === user.id || dashboardKeyAccess(c, user);
  }

  function profileAccess(c: Context, user: User, page: YoutubeDashboardPageKind = 'overview'): boolean {
    const current = registry.userByHandle(user.handle);
    if (!current || current.id !== user.id) return false;
    if (privateDashboardAccess(c, current)) return true;
    return (page === 'overview' || page === 'insights')
      && (current.dashboardPublic || mutualFriends(sessionUser(c), current));
  }

  function blendIdentity(user: User): MatchableCrystal {
    const crystal = registry.matchingCrystalFor(user.handle)
      ?? registryMatchingCrystal(cachedCrystalFor(registry, user));
    return { userId: user.id, handle: user.handle, displayName: user.displayName,
      disclosureLevel: 'topics_and_channel', crystal, dimensions: resolveMatchingDimensions(crystal, null) };
  }

  function blendCard(me: User, target: User): ActionableMatchingCandidateCard {
    const card = rankedMatchingCandidateCards(blendIdentity(me), [blendIdentity(target)])[0];
    return { ...(card ?? {
      candidateUserId: target.id, handle: target.handle, displayName: target.displayName,
      matchPercent: 0, topicPercent: null, channelPercent: null, method: 'channels' as const,
      percentageVersion: 'calibrated-v2' as const, viewerInterests: [], interests: [], sharedInterests: [],
      disclosure: { topics: [] },
    }), comparisonReady: Boolean(card), targetPublic: target.dashboardPublic,
      relationship: registry.matchingRelationshipFor(me, target.id) };
  }

  async function dashboardResponse(
    c: Context,
    user: User,
    profilePath: string,
    page: YoutubeDashboardPageKind = 'overview',
  ) {
    const lang = langOf(c);
    const repository = registry.repositoryFor(user);
    const counts = countsFor(repository);
    const processing = processingFor(repository);
    const range = requestedRange(c.req.query('range'));
    const requestedShortForm = c.req.query('shorts');
    const shortFormVariant = requestedShortForm === 'stacked'
      || requestedShortForm === 'compare'
      || requestedShortForm === 'heatmap'
      || requestedShortForm === 'absolute'
      || requestedShortForm === 'dual'
      ? requestedShortForm : undefined;
    const data = cachedDashboardFor(registry, user, range, repository, page === 'overview' ? 'overview' : page === 'insights');
    const hasData = counts.watches > 0;
    const crystalHtml = page === 'insights' && hasData
      ? shiftsSection(cachedCrystalFor(registry, user, repository), lang) : '';
    let leaningsHtml = '';
    if (page === 'insights' && hasData) {
      try {
        const snapshot = await loadTagLists();
        const tagLean = computeTagLean(
          range,
          cachedChannelTotalsFor(registry, user, range),
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
                cachedChannelTotalsFor(registry, contributor, range),
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
    // Insights may await external classification. Recheck visibility and
    // the session before rendering any data from the earlier snapshot.
    if (!profileAccess(c, user, page)) return notFoundPage(c);
    user = registry.userByHandle(user.handle)!;
    const me = sessionUser(c);
    const viewerOwns = me?.id === user.id;
    // Only the owner or an explicit dashboard key can expose individual watches.
    const showRecent = privateDashboardAccess(c, user);
    const history = page === 'history' && showRecent
      ? repository.youtubeWatchHistory(range, 100) : undefined;
    c.header('Cache-Control', me || !user.dashboardPublic || showRecent ? 'private, no-store' : 'no-cache');
    // Private dashboards reached via key/session must not end up in search
    // engines even if a keyed link leaks into a crawler.
    if (!user.dashboardPublic || showRecent) c.header('X-Robots-Tag', 'noindex');
    // Setup credentials are limited to the owner or a private dashboard key holder.
    const showSetup = viewerOwns || (showRecent && !user.dashboardPublic);
    let friendshipHtml = '';
    if (me && !viewerOwns && registry.matchingRelationshipFor(me, user.id).status !== 'none') {
      const card = blendCard(me, user);
      if (registry.matchingCandidateByHandle(me, user.handle)) {
        card.actionToken = registry.issueMatchActionToken(me, user.id, card.disclosure.topics);
      }
      friendshipHtml = friendshipActions(card, me.handle, messages(lang), profilePath, false);
    }
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
      showPrivatePages: showRecent,
      friendshipHtml,
      blendHref: !viewerOwns && (user.dashboardPublic || mutualFriends(me, user))
        ? `/blend/${user.handle}?range=${range}&lang=${lang}` : undefined,
      dashboardPrivate: !user.dashboardPublic,
      shortFormVariant,
    }));
  }

  const publicCommunityStats = communityStatsProvider(registry);
  app.get('/', (c) => {
    const lang = langOf(c);
    const t = messages(lang);
    const me = sessionUser(c);
    const primaryAction = me
      ? `<a class="lp-primary" href="/${html(me.handle)}">${t.landingMyDashboard}</a>`
      : config.signupEnabled ? `<a class="lp-primary" href="/signup">${t.landingCta}</a>` : '';
    c.header('Cache-Control', 'no-store');
    const title = lang === 'zh' ? '你的 YouTube 人生，都記得。' : 'Your YouTube life, remembered.';
    return c.html(shell(title, landingContent(lang, primaryAction, publicCommunityStats()), siteNav(c, lang), '', lang, '/'));
  });

  // Only these public, user-supplied product screenshots can be served.
  const landingImages = new Map<string, Buffer>();
  app.get('/landing-assets/:name', (c) => {
    const name = c.req.param('name');
    if (!['dashboard.png', 'channel.png', 'matching.png'].includes(name)) return c.notFound();
    let data = landingImages.get(name);
    if (!data) {
      data = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'public', 'landing', name));
      landingImages.set(name, data);
    }
    c.header('Content-Type', 'image/png');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.body(new Uint8Array(data));
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

  const avatarResponse = async (c: Context, user: User, cacheControl: string) => {
    const avatar: AvatarImage = await avatarService.avatarFor(user);
    c.header('Content-Type', avatar.contentType);
    c.header('Content-Length', String(avatar.body.byteLength));
    c.header('Cache-Control', cacheControl);
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    return c.body(avatar.body.buffer.slice(
      avatar.body.byteOffset,
      avatar.body.byteOffset + avatar.body.byteLength,
    ) as ArrayBuffer);
  };

  // Avatar URLs remain same-origin: neither email hashes nor Google/Gravatar
  // URLs reach the browser. Matching variants resolve an existing opaque
  // token and re-check consent on every request.
  // Signed-in members can see public profiles, friends and discovery avatars.
  app.get('/avatar/member/:handle', async (c) => {
    const me = sessionUser(c);
    const target = registry.userByHandle(c.req.param('handle'));
    const user = me && target && (target.id === me.id || target.dashboardPublic || mutualFriends(me, target) || (me.matchingOptIn && target.matchingOptIn))
      ? target : me ? registry.avatarUserForMember(me, c.req.param('handle')) : null;
    if (!user) return c.body(null, 404);
    return avatarResponse(c, user, 'private, no-store');
  });

  app.get('/avatar/request/:token', async (c) => {
    const me = sessionUser(c);
    const user = me ? registry.avatarUserForMatchRequest(me, c.req.param('token')) : null;
    if (!user) return c.body(null, 404);
    return avatarResponse(c, user, 'private, no-store');
  });

  app.get('/avatar/:handle', async (c) => {
    const user = registry.userByHandle(c.req.param('handle'));
    if (!user || !profileAccess(c, user)) return c.body(null, 404);
    return avatarResponse(c, user, user.dashboardPublic
      ? 'public, max-age=3600' : 'private, no-store');
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
        const refreshed = registry.refreshGoogleIdentity(existing, identity.email, identity.avatarUrl);
        startSession(c, refreshed);
        return c.redirect(identity.next || onboardingDestinationFor(refreshed));
      }
      // New Google account: park the verified identity and let them pick a
      // handle (or claim a pre-Google account).
      setCookie(c, 'urtube_signup', registry.createPendingSignup(
        identity.sub, identity.email, identity.avatarUrl,
      ), {
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
        const linked = registry.linkGoogle(user.handle, pending.sub, pending.email, pending.avatarUrl);
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
        googleSub: pending.sub, googleEmail: pending.email, avatarUrl: pending.avatarUrl ?? undefined,
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
      const updated = registry.completeOnboarding(me.handle, choice === 'join', 'topics_and_channel');
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
      clearReadCaches();
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
      clearReadCaches();
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
    const provisional = processingFor(registry.repositoryFor(me)).pending > 0;
    const respond = (
      state: Parameters<typeof matchesPage>[2],
      status: 200 | 403 = 200,
      recommendations: CohortRecommendations = { topics: [], channels: [] },
    ) => {
      c.header('Cache-Control', 'no-store');
      c.header('X-Robots-Tag', 'noindex');
      return c.html(matchesPage(
        me,
        `/${me.handle}`,
        state,
        lang,
        provisional,
        recommendations,
        langToggle(c, lang).href,
        v3.enabled ? { admin: v3.adminHandles.includes(me.handle), invitations: `<div class="mt-grid">${registry.listUsers()
          .filter(target => target.matchingOptIn && registry.matchingRelationshipFor(me, target.id).status === 'incoming')
          .map(target => candidateCard(blendCard(me, target), me.handle, lang)).join('')}</div>` } : undefined,
      ), v3.enabled && status === 403 ? 200 : status);
    };
    const publicUsers = registry.listUsers().filter(user => user.id !== me.id && user.dashboardPublic);
    const v3Members = v3.enabled && me.matchingOptIn ? registry.listUsers().filter(user => user.id !== me.id && user.matchingOptIn) : [];
    if (!me.matchingOptIn && !publicUsers.length) return respond({ kind: 'opt_in_required' }, 403);
    const crystal = registry.matchingCrystalFor(me.handle);
    const eligible = Boolean(crystal && registryCrystalEligible(crystal));
    if (!eligible && !publicUsers.length && !v3Members.length) return respond({ kind: 'data_pending' });
    const viewer = blendIdentity(me);
    const privatePool = eligible ? registry.listMatchingCandidatesFor(me, MATCHING_CANDIDATE_POOL_LIMIT) : [];
    const pool = [...new Map([...privatePool, ...publicUsers.map(blendIdentity), ...v3Members.map(blendIdentity)].map(member => [member.userId, member])).values()];
    let channelPolicy: CohortChannelPolicy | undefined;
    if (pool.length + 1 >= 4) {
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
    const currentMe = sessionUser(c);
    if (!currentMe || currentMe.id !== me.id) return c.redirect('/auth/google?next=%2Fmatches');
    const visiblePool = pool.filter(member => {
      const target = registry.userByHandle(member.handle);
      return target && (target.dashboardPublic || (currentMe.matchingOptIn && target.matchingOptIn));
    });
    const recommendations = cohortRecommendations(viewer, [viewer, ...visiblePool], channelPolicy);
    const ranked = rankedMatchingCandidateCards(viewer, visiblePool);
    const cards = [...ranked, ...[...new Map([...publicUsers, ...v3Members].map(user => [user.id, user])).values()].filter(user => {
      const target = registry.userByHandle(user.handle);
      return target && (target.dashboardPublic || (currentMe.matchingOptIn && target.matchingOptIn)) && !ranked.some(card => card.candidateUserId === user.id);
    }).map(user => blendCard(currentMe, user))];
    if (!cards.length) return respond({ kind: 'empty' }, 200, recommendations);
    const batch = matchingCandidateBatch(cards, Number(c.req.query('page') ?? 1));
    return respond({ kind: 'ready', batch: {
      ...batch,
      cards: batch.cards.map((card) => ({
        ...card,
        relationship: registry.matchingRelationshipFor(me, card.candidateUserId),
        targetPublic: Boolean(registry.userByHandle(card.handle)?.dashboardPublic),
        actionToken: currentMe.matchingOptIn && registry.userByHandle(card.handle)?.matchingOptIn
          ? registry.issueMatchActionToken(currentMe, card.candidateUserId, card.disclosure.topics) : undefined,
      })),
    } }, 200, recommendations);
  });

  app.get('/dashboard', (c) => {
    const me = sessionUser(c);
    return me ? c.redirect(`/${me.handle}`) : c.redirect('/auth/google?next=%2Fdashboard');
  });

  const actionableCandidate = (me: User, actionToken: string) => {
    const candidate = registry.matchingCandidateForAction(me, actionToken);
    const crystal = registry.matchingCrystalFor(me.handle);
    if (!candidate || !crystal || !registryCrystalEligible(crystal)) return null;
    const viewer: MatchableCrystal = {
      userId: me.id,
      handle: me.handle,
      displayName: me.displayName,
      disclosureLevel: 'topics_and_channel',
      crystal,
      dimensions: registry.matchingDimensionsFor(me),
    };
    const card = rankedMatchingCandidateCards(viewer, [candidate])[0];
    return card?.candidateUserId === candidate.userId
      ? {
        candidate,
        card: {
          ...card,
          actionToken,
          relationship: registry.matchingRelationshipFor(me, candidate.userId),
        },
      }
      : null;
  };

  const comparisonPath = (me: User, otherHandle: string) =>
    `/${encodeURIComponent(me.handle)}/compare/${encodeURIComponent(otherHandle)}`;

  const querySuffix = (c: Context) => {
    const query = new URL(c.req.url).search;
    return query || '';
  };

  app.get('/channel', (c) => c.redirect(`/channel/${querySuffix(c)}`, 308));
  app.get('/channel/', (c) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex');
    const me = sessionUser(c);
    if (!me) return c.redirect(`/auth/google?next=${encodeURIComponent(c.req.path + querySuffix(c))}`);
    const range = channelPageRange(c.req.query('range'));
    const sort = channelPageSort(c.req.query('sort'));
    const query = (c.req.query('q') ?? '').trim().slice(0, 100);
    const mine = cachedChannelTotalsFor(registry, me, range);
    let community: Array<YoutubeChannelSummary & { viewers: number }> | null = null;
    if (me.matchingOptIn) {
      const channels = new Map<string, YoutubeChannelSummary & { viewers: number }>();
      // Re-read membership on every request, even when per-user totals are cached.
      for (const member of registry.listMatchingMembers()) {
        const totals = member.id === me.id ? mine : cachedChannelTotalsFor(registry, member, range);
        for (const channel of totals) {
          if (!channel.channelId || !YOUTUBE_CHANNEL_ID_PATTERN.test(channel.channelId)) continue;
          const total = channels.get(channel.channelId) ?? { ...channel, watches: 0, estimatedWatchSeconds: 0, viewers: 0 };
          total.watches += channel.watches;
          total.estimatedWatchSeconds += channel.estimatedWatchSeconds;
          total.viewers += 1;
          if (!total.name && channel.name) total.name = channel.name;
          if (!total.thumbnailUrl && channel.thumbnailUrl) total.thumbnailUrl = channel.thumbnailUrl;
          channels.set(channel.channelId, total);
        }
      }
      community = [...channels.values()];
    }
    return c.html(channelDirectoryPage(me, { range, sort, query, mine, community }, langOf(c)));
  });

  // The channel page: the signed-in person's own history for one YouTube
  // channel, plus member rankings across everyone who joined matching.
  // Community data is reciprocal: only members contribute and only members
  // see it.
  app.get('/channel/:channelId', async (c) => {
    const channelId = c.req.param('channelId');
    if (!YOUTUBE_CHANNEL_ID_PATTERN.test(channelId)) return notFoundPage(c);
    const preview = c.req.query('preview') === '1';
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex');
    let me = sessionUser(c);
    if (!me && preview) return c.text('Sign in required', 401);
    if (!me) return c.redirect(`/auth/google?next=${encodeURIComponent(c.req.path)}`);
    const range = channelPageRange(c.req.query('range'));
    const sort = channelPageSort(c.req.query('sort'));
    const repository = registry.repositoryFor(me);
    let metadata = repository.youtubeChannelMetadata(channelId)
      ?? cachedChannelDetailFor(registry, me, channelId, range).channel;
    if (!metadata && me.matchingOptIn) {
      for (const member of registry.listMatchingMembers()) {
        metadata = registry.repositoryFor(member).youtubeChannelMetadata(channelId);
        if (metadata) break;
      }
    }
    if (metadata && (!metadata.statisticsFetchedAt || Date.now() - Date.parse(metadata.statisticsFetchedAt) > 86400_000)) {
      const fresh = await refreshChannelMetadata(channelId);
      // The external request may outlive a sign-out or opt-out. Recheck before
      // reading or rendering anyone's private aggregates.
      me = sessionUser(c);
      if (!me && preview) return c.text('Sign in required', 401);
      if (!me) return c.redirect(`/auth/google?next=${encodeURIComponent(c.req.path)}`);
      if (fresh) {
        metadata = { ...fresh, name: fresh.name || metadata.name, thumbnailUrl: fresh.thumbnailUrl || metadata.thumbnailUrl };
        registry.repositoryFor(me).upsertYoutubeChannelMetadata([metadata], metadata.statisticsFetchedAt!);
      }
    }
    const mine = cachedChannelDetailFor(registry, me, channelId, range);
    let community: Parameters<typeof channelPage>[1]['community'] = null;
    let channel = metadata ?? mine.channel;
    if (me.matchingOptIn) {
      const comparable = new Set(registry.listMatchingCandidatesFor(me, 499).map((member) => member.handle));
      const members: ChannelMemberRow[] = [];
      const videos = new Map<string, ChannelCommunityVideo>();
      for (const member of registry.listMatchingMembers()) {
        const detail = member.id === me.id ? mine : cachedChannelDetailFor(registry, member, channelId, range);
        channel ??= detail.channel;
        if (!detail.stats.watches) continue;
        members.push({
          handle: member.handle,
          displayName: member.displayName,
          isViewer: member.id === me.id,
          canCompare: comparable.has(member.handle),
          watches: detail.stats.watches,
          estimatedWatchSeconds: detail.stats.estimatedWatchSeconds,
          rank: detail.rank,
        });
        for (const video of detail.videos) {
          const entry = videos.get(video.videoId) ?? {
            videoId: video.videoId, title: video.title, thumbnailUrl: video.thumbnailUrl,
            watches: 0, estimatedWatchSeconds: 0, viewers: 0,
          };
          entry.watches += video.watches;
          entry.estimatedWatchSeconds += video.estimatedWatchSeconds;
          entry.viewers += 1;
          if (!entry.thumbnailUrl && video.thumbnailUrl) entry.thumbnailUrl = video.thumbnailUrl;
          videos.set(video.videoId, entry);
        }
      }
      community = {
        members,
        videos: [...videos.values()],
        memberCount: members.length,
      };
    }
    // Nobody who can be shown has ever seen this channel: nothing to render.
    if (!channel) return notFoundPage(c);
    if (preview) {
      c.header('X-Urtube-Fragment', 'channel-preview');
      return c.html(channelPreview({ channel, range, sort, mine, community }, langOf(c)));
    }
    return c.html(channelPage(
      { handle: me.handle, displayName: me.displayName },
      { channel, range, sort, mine, community },
      langOf(c),
    ));
  });

  // Legacy token links (20-minute lifetime) forward to the stable URL while
  // they are still valid. Registered before the handle route because
  // '/matches/compare/<token>' also matches '/:handle/compare/:other'.
  const legacyComparisonRedirect = (c: Context) => {
    const me = sessionUser(c);
    if (!me) return c.redirect(`/auth/google?next=${encodeURIComponent(c.req.path)}`);
    const candidate = registry.matchingCandidateForAction(me, c.req.param('token') ?? '');
    if (!candidate) return notFoundPage(c);
    return c.redirect(`${comparisonPath(me, candidate.handle)}${querySuffix(c)}`);
  };
  app.get('/matches/profile/:token', legacyComparisonRedirect);
  app.get('/matches/compare/:token', legacyComparisonRedirect);

  // Stable, shareable between the two people: /<me>/compare/<them>. The
  // short-lived action token is minted per render for the request/respond
  // forms, so it never has to survive in a URL.
  app.get('/blend/:handle', (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect(`/auth/google?next=${encodeURIComponent(c.req.path + querySuffix(c))}`);
    return c.redirect(`${comparisonPath(me, c.req.param('handle'))}${querySuffix(c)}`);
  });

  app.get('/:handle/compare/:other', (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect(`/auth/google?next=${encodeURIComponent(c.req.path)}`);
    const handle = c.req.param('handle');
    const otherHandle = c.req.param('other');
    if (handle !== me.handle) {
      return otherHandle === me.handle
        ? c.redirect(`${comparisonPath(me, handle)}${querySuffix(c)}`)
        : notFoundPage(c);
    }
    const other = registry.userByHandle(otherHandle);
    if (!other || other.id === me.id) return notFoundPage(c);
    if (!other.dashboardPublic && !mutualFriends(me, other)) {
      return c.redirect(`/${other.handle}${querySuffix(c)}`);
    }
    const card = blendCard(me, other);
    if (registry.matchingCandidateByHandle(me, other.handle)) {
      card.actionToken = registry.issueMatchActionToken(me, other.id, card.disclosure.topics);
    }
    const lang = langOf(c);
    const range = comparisonRange(c.req.query('range'));
    // Consent is re-read on every request: a withdrawal takes effect on the
    // next page load.
    const comparison = compareWatchProfiles(
      cachedComparisonProfileFor(registry, me, range),
      cachedComparisonProfileFor(registry, other, range),
      range,
      { connected: other.dashboardPublic || mutualFriends(me, other) },
    );
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    return c.html(matchingCandidatePage(
      me,
      '/dashboard',
      card,
      comparison,
      lang,
      `${c.req.path}?range=${range}&lang=${lang === 'zh' ? 'en' : 'zh'}`,
    ));
  });


  const matchingActionError = (c: Context) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    return c.text(messages(langOf(c)).matchesActionInvalid, 400);
  };

  const comparisonAfterAction = (c: Context, me: User, actionToken: unknown, returnTo?: unknown) => {
    const candidate = registry.friendshipCandidateForAction(me, String(actionToken ?? ''));
    if (returnTo === '/matches' || (candidate && returnTo === `/${candidate.handle}`)) return c.redirect(String(returnTo));
    return candidate ? c.redirect(comparisonPath(me, candidate.handle)) : c.redirect('/matches');
  };

  app.post('/matches/request', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/auth/google?next=%2Fmatches');
    const form = await c.req.parseBody();
    try {
      registry.createMatchRequest(me, String(form.actionToken ?? ''));
      return comparisonAfterAction(c, me, form.actionToken, form.returnTo);
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
      return comparisonAfterAction(c, me, form.actionToken, form.returnTo);
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
      return comparisonAfterAction(c, me, form.actionToken, form.returnTo);
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
      clearReadCaches();
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

  // One switch: joining matching shares everything the comparison page can
  // show (topics, channels, videos, rhythm) with people who also joined,
  // gated only by mutual consent. Leaving withdraws everything at once.
  app.post('/account/matching', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const form = await c.req.parseBody();
    try {
      registry.setMatchingPreferences(me.handle, form.matchingOptIn === '1', 'topics_and_channel', true);
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
      clearReadCaches();
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
    clearReadCaches();
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
      paths.push(root, `${root}/insights`);
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
    const data = registry.repositoryFor(user).youtubeDashboard(DEFAULT_YOUTUBE_RANGE);
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
    c.header('Cache-Control', 'private, no-store');
    const user = registry.userByHandle(c.req.param('handle') ?? '');
    if (!user || !profileAccess(c, user, page)) {
      c.header('X-Robots-Tag', 'noindex');
      return notFoundPage(c);
    }
    return dashboardResponse(c, user, `/${user.handle}`, page);
  };

  // Four primary profile pages. Each is a single full-width vertical story.
  app.get('/:handle/insights', profilePage('insights'));
  app.get('/:handle/history', profilePage('history'));
  app.get('/:handle/recap', profilePage('recap'));

  // Former fifth page: tags now render inside Insights. Keep old bookmarks
  // working, and drop a one-time dashboard key from the redirected URL after
  // profileAccess has persisted it in the HttpOnly cookie.
  app.get('/:handle/tags', (c) => {
    const user = registry.userByHandle(c.req.param('handle'));
    if (!user || !profileAccess(c, user, 'insights')) return notFoundPage(c);
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
    if (!profileAccess(c, user)) {
      const me = sessionUser(c);
      if (!me) return notFoundPage(c);
      // Every signed-in member has a browsable identity page. Interests use
      // the same reciprocal disclosure as Blend; private archives stay gated.
      const candidate = registry.matchingCandidateByHandle(me, user.handle);
      const crystal = registry.matchingCrystalFor(me.handle);
      const card = candidate && crystal && registryCrystalEligible(crystal)
        ? rankedMatchingCandidateCards({
          userId: me.id, handle: me.handle, displayName: me.displayName,
          disclosureLevel: 'topics_and_channel', crystal,
          dimensions: registry.matchingDimensionsFor(me),
        }, [candidate])[0] : null;
      c.header('Cache-Control', 'private, no-store');
      c.header('X-Robots-Tag', 'noindex');
      const lang = langOf(c);
      return c.html(memberProfilePage(me.handle, {
        handle: user.handle, displayName: user.displayName,
        avatarVisible: me.matchingOptIn && user.matchingOptIn,
        interests: card?.interests.slice(0, 3) ?? [],
        comparisonHref: null,
        friendship: me.matchingOptIn && user.matchingOptIn ? { ...(card ?? blendCard(me, user)), relationship: registry.matchingRelationshipFor(me, user.id),
          targetPublic: false, actionToken: registry.issueMatchActionToken(me, user.id, card?.disclosure.topics ?? []) } : null,
      }, lang));
    }
    return dashboardResponse(c, user, `/${user.handle}`);
  });

  app.notFound((c) => notFoundPage(c));

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
