import { cachedScore } from './matching-v3/score-cache.js';
import { presentationError } from './output/presentation-errors.js';
import { normalizeSocialUrl } from './social-links.js';
import { createHash } from 'node:crypto';
import { yieldToEventLoop } from './event-loop-turns.js';
import { ProfileError, validHandle, type ProfileInput } from './profile.js';
import { profileDetails, profileEditPage, profileMessages } from './output/profile.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { bodyLimit, privateResponses, sameOriginWrites } from './request-security.js';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { completeGoogleLogin, googleLoginConfigured, googleLoginUrl, loginStateCookie, suggestedHandle } from './auth.js';
import { AvatarService, type AvatarImage } from './avatars.js';
import { config } from './config.js';
import { settings as matchingV3Settings, version as matchingV3Version, GENRES } from './matching-v3/model.js';
import { matchingRoutes } from './matching-v3/routes.js';
import { compareMatchRank } from './matching-v3/matching.js';
import { computeClient, type Compute } from './matching-v3/compute.js';
import type { Settings as MatchingSettings } from './matching-v3/model.js';
import type { Repository } from './data/database.js';
import { cachedRead, cachedReadAsync, clearReadCaches, forgetDurableReads, type AsyncReadOptions, type DurableRead } from './data/read-cache.js';
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
import {
  buildYoutubeCrystal,
  compareCrystals,
  youtubeMatchingCrystalSection,
  type MatchingCrystal,
  type YoutubeCrystal,
  type YoutubeCrystalShiftSection,
} from './youtube/crystal.js';
import { fetchYoutubeChannelMetadata, youtubeApiUsage } from './youtube/metadata.js';
import {
  brandMark, html, primaryNav, shell,
  type PrimaryNavActive, type ShellNavItem,
} from './output/pages.js';
import { youtubeDashboardPage, type YoutubeDashboardPageKind } from './output/youtube.js';
import { historyPage } from './output/history.js';
import { HistoryQueryError, normalizeHistoryQuery, type YoutubeHistoryPage } from './youtube/history.js';
import { v3ProcessingNotice } from './output/v3-processing.js';
import { describeV3Processing } from './youtube/v3-processing.js';
import { describePipeline, estimatePipeline, processingComplete } from './youtube/pipeline-progress.js';
import { v3DashboardSection } from './output/v3-dashboard.js';
import {
  describeYoutubeProcessing,
  youtubeProcessingCapabilities,
  type YoutubeProcessingStatus,
} from './youtube/processing.js';
import { readOpsStatus, workerOpsReady, type MatchingOpsStatus, type WorkerOpsStatus } from './ops-status.js';
import { securityHeaders } from './security-headers.js';
import { forceHttps } from './https-redirect.js';
import { outliveProxyKeepAlive } from './origin-server.js';
import { importArchive } from './archive-import.js';
import { readMethodOffThread, readOffThread, readPoolIdle, readPoolPending, withReadPriority } from './read-pool.js';
import { stageTimer, watchEventLoop } from './timing.js';
import { computeTagLean, fetchTagLists, type TagLeanData } from './youtube/taglists.js';
import { tagLeanSection } from './output/taglean.js';
import { referencePopulation as buildReferencePopulation, type ReferenceContribution } from './youtube/reference-population.js';
import { MAX_YOUTUBE_ARCHIVE_BYTES } from './youtube/takeout.js';
import { DEFAULT_HANDLE, timingSafeEquals, UserRegistry, type MatchableCrystal, type User } from './users.js';
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
// Dashboard aggregates run on the read pool so a slow archive never blocks
// other requests or the health checks (src/read-pool.ts).
function cachedDashboardFor(registry: UserRegistry, user: User, range: YoutubeRange, repository = registry.repositoryFor(user), includeInsights: boolean | 'overview' | 'summary' = false, staleFor = 0): Promise<YoutubeDashboardData> {
  return cachedReadAsync(repository, `dashboard:${range}:${includeInsights}`, () => readOffThread(repository, registry.databasePathFor(user), 'dashboard',
    { range, now: new Date().toISOString(), includeInsights }) as Promise<YoutubeDashboardData>, undefined, readOptions(registry, user, staleFor, DURABLE.dashboard));
}
// Visitors other than the owner may see aggregates up to this old while a
// refresh runs (src/data/read-cache.ts). Cold, they took 20-90 s per Insights
// page on 2026-10-23. Owner actions clear the caches; access is per request.
const PUBLIC_STALE_MS = 24 * 3600_000;
// A visit refreshes an aggregate older than this; younger ones are served as
// they are. Every Insights page reads 14 contributors and the landing page 24
// archives, so at 10 minutes refreshes alone kept the read threads busy.
const PUBLIC_REFRESH_MS = 60 * 60_000;
// What each read may keep on disk (src/data/read-cache.ts): public aggregates
// only. Bump a version when its calculation or shape changes.
type DurableShape = Pick<DurableRead, 'version' | 'project' | 'valid'>;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const same = (value: unknown) => value;
const DURABLE: Record<'dashboard' | 'channels' | 'tagLean' | 'crystalShifts' | 'popularity' | 'counts' | 'metadata' | 'referenceUpdated', DurableShape> = {
  // Individual recent watches (titles, URLs, exact times) are never written.
  dashboard: { version: 'dashboard:1', project: (value) => ({ ...(value as YoutubeDashboardData), recent: [] }),
    valid: (value) => isRecord(value) && isRecord(value.stats) && Array.isArray(value.daily) && Array.isArray(value.topChannels)
      && Array.isArray(value.recent) && value.recent.length === 0 },
  channels: { version: 'channels:1', project: same, valid: (value) => Array.isArray(value)
    && value.every((row) => isRecord(row) && typeof row.watches === 'number' && typeof row.estimatedWatchSeconds === 'number') },
  crystalShifts: { version: 'crystal-shifts:1', project: same, valid: (value) => isRecord(value) && Array.isArray(value.shifts) },
  popularity: { version: 'popularity:1', project: same, valid: (value) => isRecord(value) && typeof value.totalVideos === 'number' },
  tagLean: { version: 'tag-lean:1', project: same, valid: (value) => isRecord(value) && isRecord(value.totals) && isRecord(value.provenance)
    && Array.isArray(value.content) && Array.isArray(value.political) },
  counts: { version: 'counts:1', project: same, valid: (value) => isRecord(value) && typeof value.watches === 'number' },
  metadata: { version: 'metadata-processing:1', project: same, valid: isRecord },
  // Shown by day only; the exact latest-activity time is not kept.
  referenceUpdated: { version: 'reference-updated:1', project: (value) => typeof value === 'string' ? value.slice(0, 10) : null,
    valid: (value) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) },
};
// staleFor 0 (the owner, key holders): current data, no durable copy read or
// written. Every read still knows its archive, so an import or deletion while
// it runs discards the result.
function readOptions(registry: UserRegistry, user: User, staleFor: number, shape: DurableShape): AsyncReadOptions {
  const path = registry.databasePathFor(user);
  return staleFor
    ? { staleFor, refreshAfter: PUBLIC_REFRESH_MS, archive: path, durable: { path, subject: user.id, ...shape } }
    : { archive: path };
}
function cachedComparisonProfileFor(registry: UserRegistry, user: User, range: ComparisonRange, repository = registry.repositoryFor(user)): Promise<YoutubeComparisonProfile> {
  return cachedReadAsync(repository, `comparison:${range}`, () => readMethodOffThread(repository, registry.databasePathFor(user),
    'youtubeComparisonProfile', MATCHING_TAXONOMY.version, range, new Date()));
}
function cachedChannelDetailFor(registry: UserRegistry, user: User, channelId: string, range: ChannelPageRange, repository = registry.repositoryFor(user)): Promise<YoutubeChannelDetail> {
  return cachedReadAsync(repository, `channel:${channelId}:${range}`, () => readMethodOffThread(repository, registry.databasePathFor(user),
    'youtubeChannelDetail', channelId, range, new Date()));
}
function cachedChannelTotalsFor(registry: UserRegistry, user: User, range: YoutubeRange, staleFor = 0, memory = true): Promise<YoutubeChannelSummary[]> {
  const repository = registry.repositoryFor(user);
  return cachedReadAsync(repository, `channels:${range}`, () => readMethodOffThread(repository, registry.databasePathFor(user),
    'youtubeChannelTotals', range, new Date()), undefined, { ...readOptions(registry, user, staleFor, DURABLE.channels), memory });
}
// One account's leanings against the tag lists. Cached instead of its input:
// an Insights page needs 14 contributors' leanings, and their full channel
// totals (up to ~12,000 rows each) kept in memory were paged back in from swap
// on every render. The totals are read (from their durable copy if public)
// only when the leanings are recomputed, and are not kept.
function cachedTagLeanFor(registry: UserRegistry, user: User, range: YoutubeRange, snapshot: TagListSnapshot, staleFor = 0): Promise<TagLeanData> {
  const repository = registry.repositoryFor(user);
  const { membershipVersion, policyVersion } = snapshot.provenance;
  return cachedReadAsync(repository, `tag-lean:${range}:${policyVersion}:${membershipVersion}`,
    async () => computeTagLean(range, await cachedChannelTotalsFor(registry, user, range, staleFor, false), snapshot),
    undefined, readOptions(registry, user, staleFor, DURABLE.tagLean));
}
function pooledCountsFor(registry: UserRegistry, user: User, repository = registry.repositoryFor(user), staleFor = 0): Promise<ReturnType<Repository['youtubeCounts']>> {
  return cachedReadAsync(repository, 'counts', () => readMethodOffThread(repository, registry.databasePathFor(user), 'youtubeCounts'),
    undefined, readOptions(registry, user, staleFor, DURABLE.counts));
}
function cachedCrystalFor(registry: UserRegistry, user: User, repository = registry.repositoryFor(user)): YoutubeCrystal {
  return cachedRead(repository, `crystal:${user.handle}:${user.displayName}`, () => buildYoutubeCrystal(repository, user));
}
// Pages that need only one part of the crystal must not pay for the
// all-time window: a full build took up to 83 s on a production archive
// under memory pressure, blocking every request in this process.
function cachedMatchingSectionFor(registry: UserRegistry, user: User, repository = registry.repositoryFor(user)): MatchingCrystal {
  const matching = cachedRead(repository, 'crystal-matching', () => youtubeMatchingCrystalSection(repository));
  return { handle: user.handle, displayName: user.displayName, matching };
}
async function cachedMatchingCrystalFor(registry: UserRegistry, user: User, repository = registry.repositoryFor(user)): Promise<MatchingCrystal> {
  const matching = await cachedReadAsync(repository, 'crystal-matching', () => readOffThread(repository, registry.databasePathFor(user),
    'matchingCrystal', { now: new Date().toISOString() }) as Promise<MatchingCrystal['matching']>);
  return { handle: user.handle, displayName: user.displayName, matching };
}
function cachedCrystalShiftsFor(registry: UserRegistry, user: User, repository = registry.repositoryFor(user), staleFor = 0): Promise<YoutubeCrystalShiftSection> {
  return cachedReadAsync(repository, 'crystal-shifts', () => readOffThread(repository, registry.databasePathFor(user), 'crystalShifts',
    { now: new Date().toISOString() }) as Promise<YoutubeCrystalShiftSection>, undefined, readOptions(registry, user, staleFor, DURABLE.crystalShifts));
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
    return (await fetchYoutubeChannelMetadata([channelId], undefined, boundedFetch))[0] ?? null;
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
  const smallBodyLimit = bodyLimit({ maxSize: 1024 * 1024 });
  app.use('*', securityHeaders(true));
  app.use('*', privateResponses());
  app.use('*', forceHttps());
  app.use('*', sameOriginWrites(config.publicBaseUrl));
  app.use('/account/profile', bodyLimit({ maxSize: 100_000 }));
  // Multipart framing adds a little overhead around the ZIP itself. The
  // limit applies while streaming, so a missing Content-Length no longer
  // lets the runtime buffer an oversized upload before it is rejected.
  app.use('/account/takeout', bodyLimit({
    maxSize: MAX_YOUTUBE_ARCHIVE_BYTES + 1024 * 1024,
    onError: (c) => {
      const me = sessionUser(c);
      c.header('Cache-Control', 'no-store');
      if (!me) return c.text('Payload Too Large', 413);
      const lang = langOf(c);
      return c.html(accountPage(me, accountStateFor(me, { takeoutError: messages(lang).accountTakeoutTooLarge }), lang), 413);
    },
  }));
  // Every other form on the site is small; cap them all.
  app.use('*', async (c, next) => c.req.path === '/account/takeout' || /^\/(?:api\/)?matching-v3(?:\/|$)/.test(c.req.path) ? next() : smallBodyLimit(c, next));
  app.use('*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') {
      const url = new URL(c.req.url);
      const match = url.pathname.match(/^\/(?:u\/)?([^/]+)(\/(?:insights|history|recap|tags|summary\.json|crystal\.json))?$/);
      if (match?.[2] === '/history') {
        c.header('Cache-Control', 'private, no-store');
        c.header('X-Robots-Tag', 'noindex');
      }
      const user = match && validHandle(match[1]) ? registry.userByAlias(match[1]) : null;
      if (user && match) {
        // Carry a previously issued handle cookie into the stable ID cookie.
        const oldKey = getCookie(c, `urtube_dash_${match[1]}`);
        if (oldKey && registry.userByDashboardToken(user.handle, oldKey)) {
          setCookie(c, `urtube_dash_id_${user.id}`, oldKey, { httpOnly: true, sameSite: 'Lax', path: '/', secure: secureCookies, maxAge: 180 * 86400 });
        }
        const keyed = dashboardKeyAccess(c, user);
        const page = match[2] === '/history' ? 'history' : match[2] === '/recap' ? 'recap' : match[2] === '/insights' ? 'insights' : 'overview';
        if (!profileAccess(c, user, page) && !keyed && !(oldKey && registry.userByDashboardToken(user.handle, oldKey))) return notFoundPage(c);
        url.searchParams.delete('key');
        c.header('Cache-Control', page === 'history' ? 'private, no-store' : 'no-store');
        return c.redirect(`${url.pathname.startsWith('/u/') ? '/u' : ''}/${user.handle}${match[2] ?? ''}${url.search}`, 302);
      }
    }
    await next();
  });
  const v3 = services.matchingV3?.settings ?? matchingV3Settings();
  const readinessCompute = v3.enabled ? services.matchingV3?.compute ?? computeClient(v3) : null;
  if (v3.enabled) app.route('/', matchingRoutes(registry, v3, config.publicBaseUrl, services.matchingV3?.compute, (viewer, target, result, lang) => {
    const card = blendCard(viewer, target);
    if (viewer.matchingOptIn && target.matchingOptIn) card.actionToken = registry.issueMatchActionToken(viewer, target.id, card.disclosure.topics);
    card.topicMatch = { score: result.score, provisional: result.provisional, reasons: result.reasons.map(reason => reason.text), detailsVisible: result.detailsVisible, selected: result.details.map(detail => detail.genre) };
    return candidateCard(card, viewer.handle, lang);
  }));
  const v3DataWith = (user: User, metadata: ReturnType<Repository['youtubeMetadataProcessingCounts']>) => {
    const store = v3.enabled ? registry.matchingV3Store() : null;
    const profile = store?.profile(user.id) ?? null;
    return { profile, processing: describeV3Processing({
      metadata,
      metadataEnabled: Boolean(config.youtube.apiKey), enabled: v3.enabled,
      profileVersion: matchingV3Version(v3), backfillVideoLimit: v3.backfillVideoLimit,
      profile, job: store?.processingStatus(user.id) ?? null,
    }) };
  };
  const v3DataFor = (user: User) => {
    const repository = registry.repositoryFor(user);
    return v3DataWith(user, cachedRead(repository, 'metadata-processing', () => repository.youtubeMetadataProcessingCounts(), 5000));
  };
  // Same data with the metadata counts computed on the read pool.
  const pooledV3MetadataFor = (user: User, staleFor = 0) => {
    const repository = registry.repositoryFor(user);
    return cachedReadAsync(repository, 'metadata-processing', () =>
      readMethodOffThread(repository, registry.databasePathFor(user), 'youtubeMetadataProcessingCounts', new Date()), 5000,
      readOptions(registry, user, staleFor, DURABLE.metadata));
  };
  const pooledV3DataFor = async (user: User) => v3DataWith(user, await pooledV3MetadataFor(user));
  // Session-only progress, independent of matching consent or whether v3 is enabled.
  app.get('/api/processing', (c) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex');
    const me = sessionUser(c);
    if (!me) return c.json({ error: 'login_required' }, 401);
    const repository = registry.repositoryFor(me);
    const now = Date.now();
    const range = requestedRange(c.req.query('range'));
    const summary = cachedRead(repository, `pipeline-progress:${range}`, () => repository.youtubeProcessingWindow(range, new Date()), 10000);
    const history = cachedRead(repository, 'pipeline-history', () => ({
      metadata: repository.youtubeMetadataProcessingCounts(), topics: repository.youtubeTopicProcessingProgress(),
    }), 10000);
    const store = v3.enabled ? registry.matchingV3Store() : null;
    const job = store?.status(me.id) ?? null;
    const profile = store?.profile(me.id) ?? null;
    const pipeline = estimatePipeline(repository, describePipeline({ ...summary, selectedRange: range,
      capabilities: youtubeProcessingCapabilities(), worker: readOpsStatus<WorkerOpsStatus>('worker'),
      workerStage: repository.youtubeSyncState('worker_stage'), v3Enabled: v3.enabled,
      job, profile, profileVersion: matchingV3Version(v3), now,
    }), now, range);
    const historyPipeline = estimatePipeline(repository, describePipeline({ ...history,
      capabilities: youtubeProcessingCapabilities(), worker: readOpsStatus<WorkerOpsStatus>('worker'),
      workerStage: repository.youtubeSyncState('worker_stage'), v3Enabled: v3.enabled,
      job, profile, profileVersion: matchingV3Version(v3), now,
    }), now, 'history');
    return c.json({ pipeline, range, complete: processingComplete(pipeline), history: historyPipeline.filter(stage => ['topics', 'metadata'].includes(stage.id)), sampledAt: now, genres: GENRES, job,
      profile: profile ? { builtAt: profile.builtAt, complete: profile.complete,
        totalVideos: profile.totalVideos, processedVideos: profile.processedVideos,
        currentVersion: profile.version === matchingV3Version(v3),
        genres: Object.fromEntries(Object.entries(profile.genres).map(([genre, value]) =>
          [genre, { status: value.status, videoCount: value.videoCount }])) } : null,
    });
  });

  const accountStateFor = (user: User, state: AccountPageState = {}): AccountPageState => ({
    extensionVersion: extensionVersion(),
    videoCount: countsFor(registry.repositoryFor(user)).videos,
    ...state,
    v3Processing: v3DataFor(user).processing,
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
    const cookieName = `urtube_dash_id_${user.id}`;
    const key = c.req.query('key') ?? getCookie(c, cookieName) ?? getCookie(c, `urtube_dash_${user.handle}`) ?? '';
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
      ?? registryMatchingCrystal({ generatedAt: new Date().toISOString(), ...cachedMatchingSectionFor(registry, user) });
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

  async function fillV3Score(me: User, other: User, card: ActionableMatchingCandidateCard, requested?: string[]): Promise<void> {
    if (v3.enabled) {
      await yieldToEventLoop();
      const store = registry.matchingV3Store();
      const available = store.preferences(me.id).genres.filter(genre => store.preferences(other.id).genres.includes(genre));
      const selected = requested ? available.filter(genre => requested.includes(genre)) : available;
      const left = store.profile(me.id), right = store.profile(other.id);
      card.topicMatch = { score: null, provisional: true, reasons: [], detailsVisible: true,
        details: [], unavailable: 'pending', available, selected };
      if (!me.matchingOptIn || !other.matchingOptIn || !selected.length) card.topicMatch.unavailable = 'consent';
      else if (left && right) {
        try {
          const result = await cachedScore(store, me.id, other.id, left, right,
            selected, services.matchingV3?.compute ?? computeClient(v3));
          if (!result) return;
          // Recheck session, visibility, profile freshness and both consents after computation.
          const viewer = registry.userByHandle(me.handle), target = registry.userByHandle(other.handle);
          if (!viewer || viewer.id !== me.id) return;
          if (!target || (!target.dashboardPublic && !(viewer.matchingOptIn && target.matchingOptIn))) return;
          if (viewer.matchingOptIn && target.matchingOptIn
            && selected.every(genre => store.preferences(viewer.id).genres.includes(genre) && store.preferences(target.id).genres.includes(genre))
            && store.profile(viewer.id)?.builtAt === left.builtAt && store.profile(target.id)?.builtAt === right.builtAt
            && store.profile(viewer.id)?.version === left.version && store.profile(target.id)?.version === right.version) {
            card.topicMatch = { score: result.score, provisional: result.provisional, reasons: [], detailsVisible: target.dashboardPublic || mutualFriends(viewer, target),
              details: result.details.map(detail => ({ genre: detail.genre, score: detail.score, keywords: result.keywords[detail.genre] ?? [] })), unavailable: 'pending', available, selected };
          }
        } catch { card.topicMatch.unavailable = 'service'; }
      }
    }
  }

  async function dashboardResponse(
    c: Context,
    user: User,
    profilePath: string,
    page: YoutubeDashboardPageKind = 'overview',
  ) {
    const lang = langOf(c);
    const repository = registry.repositoryFor(user);
    // The owner and dashboard-key holders can see individual watches: they get
    // current, complete data. Everyone else may get the public aggregates.
    const staleFor = privateDashboardAccess(c, user) ? 0 : PUBLIC_STALE_MS;
    const timer = stageTimer('page', { page, viewer: staleFor ? 'public' : 'private' });
    const counts = await pooledCountsFor(registry, user, repository, staleFor);
    timer.mark('counts');
    const range = requestedRange(c.req.query('range'));
    const requestedShortForm = c.req.query('shorts');
    const shortFormVariant = requestedShortForm === 'stacked'
      || requestedShortForm === 'compare'
      || requestedShortForm === 'heatmap'
      || requestedShortForm === 'absolute'
      || requestedShortForm === 'dual'
      ? requestedShortForm : undefined;
    const data = await cachedDashboardFor(registry, user, range, repository, page === 'overview' ? 'overview' : page === 'insights', staleFor);
    timer.mark('dashboard');
    const hasData = counts.watches > 0;
    const crystalHtml = page === 'insights' && hasData
      ? shiftsSection({ handle: user.handle, ...await cachedCrystalShiftsFor(registry, user, repository, staleFor) }, lang) : '';
    timer.mark('crystal');
    let leanings: { tagLean: TagLeanData; contributions: ReferenceContribution[] } | 'unavailable' | undefined;
    if (page === 'insights' && hasData) {
      try {
        const snapshot = await loadTagLists();
        timer.mark('tagLists');
        const tagLean = await cachedTagLeanFor(registry, user, range, snapshot, staleFor);
        timer.mark('ownTotals');
        // Every contributor's totals load in parallel on the read pool.
        const contributions = (await Promise.all(registry.listReferencePopulationUsers().map(async (contributor) => {
          // Unindexed MAX() over each archive: a full scan, so off this thread.
          const contributorRepository = registry.repositoryFor(contributor);
          const dataUpdatedAt = await cachedReadAsync(contributorRepository, 'reference-updated', () => readMethodOffThread(
            contributorRepository, registry.databasePathFor(contributor), 'youtubeReferenceDataUpdatedAt'), undefined,
            readOptions(registry, contributor, staleFor, DURABLE.referenceUpdated));
          if (!dataUpdatedAt) return [];
          return [{
            subjectId: contributor.id,
            dataUpdatedAt,
            data: contributor.id === user.id ? tagLean : await cachedTagLeanFor(registry, contributor, range, snapshot, staleFor),
          }];
        }))).flat();
        timer.mark('reference');
        leanings = { tagLean, contributions };
      } catch (error) {
        console.warn('channel classifications unavailable:',
          error instanceof Error ? error.message : 'unknown error');
        leanings = 'unavailable';
      }
    }
    const popularity = page === 'insights' && hasData
      ? await cachedReadAsync(repository, `popularity:${range}`, () => readOffThread(repository, registry.databasePathFor(user), 'popularity',
        { range, now: new Date().toISOString() }) as Promise<ReturnType<Repository['youtubePopularity']>>, undefined,
        readOptions(registry, user, staleFor, DURABLE.popularity)) : undefined;
    timer.mark('popularity');
    const v3Metadata = await pooledV3MetadataFor(user, staleFor);
    timer.mark('metadata');
    // Every await is above. Nothing below yields before the response, so
    // visibility, the session and reference consent are checked as of render,
    // not as of the earlier reads.
    if (!profileAccess(c, user, page)) return notFoundPage(c);
    user = registry.userByHandle(user.handle)!;
    const me = sessionUser(c);
    const viewerOwns = me?.id === user.id;
    const v3Data = v3DataWith(user, v3Metadata);
    let leaningsHtml = '';
    if (leanings) {
      const unavailable = `<section class="section"><div class="section-head"><h2>${messages(lang).tagLeanTitle}</h2></div><p class="muted">${messages(lang).tagLeanUnavailable}</p></section>`;
      try {
        // Contributors who withdrew or were deleted while the reads ran drop out.
        const consenting = new Set(registry.listReferencePopulationUsers().map((contributor) => contributor.id));
        leaningsHtml = leanings === 'unavailable' ? unavailable : tagLeanSection(
          leanings.tagLean,
          lang,
          buildReferencePopulation(leanings.tagLean, leanings.contributions.filter((contribution) => consenting.has(contribution.subjectId))),
          { owner: viewerOwns },
        );
      } catch (error) {
        console.warn('reference population unavailable:', error instanceof Error ? error.message : 'unknown error');
        leaningsHtml = unavailable;
      }
    }
    const selectedGenres = viewerOwns ? [...GENRES] : user.matchingOptIn && v3.enabled
      ? registry.matchingV3Store().preferences(user.id).genres : [];
    const visibleProcessing = viewerOwns || selectedGenres.length ? v3Data.processing
      : { ...v3Data.processing, state: 'disabled' as const, progress: null, profile: null };

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
    const response = c.html(youtubeDashboardPage(user.displayName, data, requestedSort(c.req.query('sort')), {
      basePath: pagePath,
      profilePath,
      profileHtml: profileDetails(user, viewerOwns, lang),
      viewerOwns,
      page,
      lang,
      nav: siteNav(c, lang, viewerOwns
        ? 'dashboard'
        : !me && user.handle === DEFAULT_HANDLE ? 'example' : undefined),
      setupHtml: showSetup ? dashboardSetupSection(user, hasData, lang) : '',
      // Every visitor, not just the owner: a public reader deserves to know
      // the figures are still settling.
      processingHtml: hasData || viewerOwns ? v3ProcessingNotice(visibleProcessing, lang, { ownerDetails: viewerOwns }) : '',
      statsProvisional: v3Data.processing.metadata.enabled && v3Data.processing.metadata.videosPendingMetadata > 0,
      insightsHtml: crystalHtml + leaningsHtml,
      popularity,
      v3Html: v3DashboardSection(v3Data.profile, {
        enabled: v3.enabled, currentVersion: matchingV3Version(v3), backfillVideoLimit: v3.backfillVideoLimit,
        genres: selectedGenres, lang, provisional: v3Data.processing.state !== 'done', ownerDetails: viewerOwns,
      }),
      history,
      showRecent,
      showPrivatePages: showRecent,
      friendshipHtml,
      blendHref: !viewerOwns && (user.dashboardPublic || mutualFriends(me, user))
        ? `/blend/${user.handle}?range=${range}&lang=${lang}` : undefined,
      dashboardPrivate: !user.dashboardPublic,
      shortFormVariant,
    }));
    timer.mark('render');
    timer.log();
    return response;
  }

  // Channel totals run on the read pool so a cold refresh never blocks the
  // request thread (src/youtube/community.ts).
  const publicCommunityStats = communityStatsProvider({
    listUsers: () => registry.listUsers(),
    // The landing page waits at most 2 s for these; refreshing them is
    // background work for the read pool.
    // Not kept in memory: the provider keeps its small result, and 24 full
    // channel lists held between visits were swapped out (see cachedTagLeanFor).
    repositoryFor: (user: User) => ({ youtubeChannelTotals: () => withReadPriority({ background: true },
      () => cachedChannelTotalsFor(registry, user, '90d', PUBLIC_STALE_MS, false)) }),
  });
  app.get('/', async (c) => {
    const stats = await publicCommunityStats();
    const lang = langOf(c);
    const t = messages(lang);
    const me = sessionUser(c);
    const primaryAction = me
      ? `<a class="lp-primary" href="/${html(me.handle)}">${t.landingMyDashboard}</a>`
      : config.signupEnabled ? `<a class="lp-primary" href="/signup">${t.landingCta}</a>` : '';
    c.header('Cache-Control', 'no-store');
    const title = lang === 'zh' ? '你的 YouTube 人生，都記得。' : 'Your YouTube life, remembered.';
    return c.html(shell(title, landingContent(lang, primaryAction, stats), siteNav(c, lang), '', lang, '/'));
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
    c.header('Cache-Control', avatar.source !== 'google' && cacheControl.startsWith('public') ? 'public, max-age=60' : cacheControl);
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    return c.body(avatar.body.buffer.slice(
      avatar.body.byteOffset,
      avatar.body.byteOffset + avatar.body.byteLength,
    ) as ArrayBuffer);
  };

  // Avatar URLs remain same-origin: Google image URLs never reach the browser. Matching variants resolve an existing opaque
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
      const url = googleLoginUrl(registry, c.req.query('next') ?? '');
      // The server-side state proves the round trip started here, not that
      // it started in this browser. Binding it to a cookie stops someone from
      // handing a victim their own callback link and logging them into the
      // attacker's account (login CSRF).
      const state = new URL(url).searchParams.get('state')!;
      setCookie(c, loginStateCookie(state), state, {
        httpOnly: true, sameSite: 'Lax', path: '/auth/google', secure: secureCookies, maxAge: 600,
      });
      return c.redirect(url);
    } catch (error) {
      return c.text(presentationError(error, langOf(c), 'login'), 503);
    }
  });

  app.get('/auth/google/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!state) return c.text(presentationError(null, langOf(c), 'login'), 400);
    const browserState = getCookie(c, loginStateCookie(state)) ?? '';
    deleteCookie(c, loginStateCookie(state), { path: '/auth/google', httpOnly: true, sameSite: 'Lax', secure: secureCookies });
    if (!browserState || !timingSafeEquals(browserState, state)) {
      return c.text(presentationError(null, langOf(c), 'login'), 400);
    }
    // Cancellation consumes only this browser's transaction. Other tabs keep
    // their independent short-lived cookies and can complete normally.
    if (c.req.query('error') || !code) {
      registry.consumeLoginState(state);
      return c.req.query('error') ? c.redirect('/signup') : c.text(presentationError(null, langOf(c), 'login'), 400);
    }
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
      return c.text(presentationError(error, langOf(c), 'login'), 400);
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
        return c.html(signupCompletePage(pageInput, presentationError(error, lang, 'signup'), lang), 409);
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
      if (!registry.handleAvailable(handle)) {
        return c.html(signupCompletePage(pageInput, t.errHandleTaken(handle), lang), 409);
      }
      const created = registry.createUser(handle, displayName, {
        googleSub: pending.sub, googleEmail: pending.email, avatarUrl: pending.avatarUrl ?? undefined,
        dashboardPublic: false,
      });
      finish(created);
      c.header('Cache-Control', 'no-store');
      return c.redirect('/onboarding');
    } catch (error) {
      return c.html(signupCompletePage(pageInput, presentationError(error, lang, 'signup'), lang), 400);
    }
  });

  app.get('/onboarding', (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/auth/google?next=%2Fonboarding');
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    return c.html(guidedOnboardingPage(me, onboardingStateFor(me), langOf(c), v3DataFor(me).processing));
  });

  app.post('/onboarding/finish', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/auth/google?next=%2Fonboarding');
    if (onboardingStateFor(me).step !== 'consent') {
      return c.text(presentationError(null, langOf(c), 'settings'), 409);
    }
    const form = await c.req.parseBody();
    if (form.preferencesSubmitted !== '1'
      || (form.matchingOptIn !== undefined && form.matchingOptIn !== '1')
      || (form.dashboardPublic !== undefined && form.dashboardPublic !== '1')) {
      return c.text(presentationError(null, langOf(c), 'settings'), 400);
    }
    try {
      const updated = registry.completeOnboarding(
        me.handle, form.matchingOptIn === '1', 'topics_and_channel', form.dashboardPublic === '1',
      );
      return c.redirect(updated.matchingOptIn ? '/matches' : `/${updated.handle}`);
    } catch {
      return c.text(presentationError(null, langOf(c), 'settings'), 400);
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
      // The extension partitions its offline queue and sync checkpoints by
      // this immutable id (handles can be renamed); the handle only lets it
      // recognise a connection made before ids were delivered.
      accountId: String(me.id),
      handle: me.handle,
    });
  });

  // Live handle-availability check for the signup form; gated behind a
  // verified pending signup so it is not an anonymous enumeration endpoint.
  app.get('/signup/handle-check', (c) => {
    const pending = registry.pendingSignup(getCookie(c, 'urtube_signup') ?? '');
    if (!pending) return c.json({ error: 'no pending signup' }, 403);
    const handle = (c.req.query('handle') ?? '').trim().toLocaleLowerCase('en-US');
    if (!validHandle(handle)) return c.json({ available: false, invalid: true });
    return c.json({ available: registry.handleAvailable(handle) });
  });

  app.get('/account', (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    c.header('Cache-Control', 'no-store');
    const updated = c.req.query('updated');
    return c.html(accountPage(me, accountStateFor(me, {
      updated: updated === 'visibility' || updated === 'matching' || updated === 'reference' ? updated : undefined,
    }), langOf(c)));
  });

  // Retire the review UI without deleting stored legacy classifications or
  // changing the existing worker. Old bookmarks lead to the current progress.
  app.get('/account/taxonomy', c => {
    if (!sessionUser(c)) return c.redirect('/signup');
    c.header('Cache-Control', 'no-store');
    return c.redirect(`/account${c.req.query('lang') ? `?lang=${langOf(c)}` : ''}#processing`);
  });
  for (const path of ['/account/taxonomy/prepare', '/account/taxonomy/:version/activate']) {
    app.post(path, c => {
      if (!sessionUser(c)) return c.redirect('/signup');
      c.header('Cache-Control', 'no-store');
      return c.text(langOf(c) === 'zh' ? '這個操作已無法使用，請返回設定頁。' : 'This action is no longer available. Return to Settings.', 410);
    });
  }

  app.get('/matches', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/auth/google?next=%2Fmatches');
    const lang = langOf(c);
    const processing = (await pooledV3DataFor(me)).processing;
    const provisional = !['done', 'disabled'].includes(processing.state);
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
        v3.enabled ? { admin: v3.adminHandles.includes(me.storageName), invitations: `<div class="mt-grid">${registry.listUsers()
          .filter(target => target.matchingOptIn && registry.matchingRelationshipFor(me, target.id).status === 'incoming')
          .map(target => candidateCard(blendCard(me, target), me.handle, lang)).join('')}</div>` } : undefined,
        v3ProcessingNotice(processing, lang, { ownerDetails: true, alwaysShow: true }),
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
    const rankedUserIds = new Set(ranked.map(card => card.candidateUserId));
    const baseCards = [...ranked, ...[...new Map([...publicUsers, ...v3Members].map(user => [user.id, user])).values()].filter(user => {
      const target = registry.userByHandle(user.handle);
      return target && (target.dashboardPublic || (currentMe.matchingOptIn && target.matchingOptIn)) && !rankedUserIds.has(user.id);
    }).map(user => blendCard(currentMe, user))];
    const scoredCards = await Promise.all(baseCards.map(async candidate => {
      const target = registry.userByHandle(candidate.handle);
      if (!target) return null;
      const card: ActionableMatchingCandidateCard = { ...candidate, relationship: registry.matchingRelationshipFor(currentMe, target.id), targetPublic: target.dashboardPublic };
      await fillV3Score(currentMe, target, card);
      return card;
    }));
    const finalViewer = sessionUser(c);
    if (!finalViewer || finalViewer.id !== me.id) return c.redirect('/auth/google?next=%2Fmatches');
    const cards = scoredCards.filter((card): card is ActionableMatchingCandidateCard => {
      if (!card) return false;
      const target = registry.userByHandle(card.handle);
      if (!target || !(target.dashboardPublic || (finalViewer.matchingOptIn && target.matchingOptIn))) return false;
      if (card.topicMatch && (!finalViewer.matchingOptIn || !target.matchingOptIn
        || card.topicMatch.selected?.some(genre => !registry.matchingV3Store().preferences(me.id).genres.includes(genre)
          || !registry.matchingV3Store().preferences(target.id).genres.includes(genre)))) {
        card.topicMatch = { score:null,provisional:true,reasons:[],detailsVisible:false };
      }
      return true;
    });
    if (v3.enabled) cards.sort((a, b) => compareMatchRank(a.topicMatch ?? { provisional: true, score: null }, b.topicMatch ?? { provisional: true, score: null }));
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
  app.get('/channel/', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex');
    const me = sessionUser(c);
    if (!me) return c.redirect(`/auth/google?next=${encodeURIComponent(c.req.path + querySuffix(c))}`);
    const range = channelPageRange(c.req.query('range'));
    const sort = channelPageSort(c.req.query('sort'));
    const query = (c.req.query('q') ?? '').trim().slice(0, 100);
    const mine = await cachedChannelTotalsFor(registry, me, range);
    let community: Array<YoutubeChannelSummary & { viewers: number }> | null = null;
    if (me.matchingOptIn) {
      const channels = new Map<string, YoutubeChannelSummary & { viewers: number }>();
      // Re-read membership on every request, even when per-user totals are cached.
      const members = registry.listMatchingMembers();
      const memberTotals = await Promise.all(members.map((member) =>
        member.id === me.id ? mine : cachedChannelTotalsFor(registry, member, range)));
      for (const totals of memberTotals) {
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
      ?? (await cachedChannelDetailFor(registry, me, channelId, range)).channel;
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
    const mine = await cachedChannelDetailFor(registry, me, channelId, range);
    let community: Parameters<typeof channelPage>[1]['community'] = null;
    let channel = metadata ?? mine.channel;
    if (me.matchingOptIn) {
      const comparable = new Set(registry.listMatchingCandidatesFor(me, 499).map((member) => member.handle));
      const members: ChannelMemberRow[] = [];
      const videos = new Map<string, ChannelCommunityVideo>();
      const matchingMembers = registry.listMatchingMembers();
      const details = await Promise.all(matchingMembers.map((member) =>
        member.id === me.id ? mine : cachedChannelDetailFor(registry, member, channelId, range)));
      for (const [index, member] of matchingMembers.entries()) {
        const detail = details[index];
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

  app.get('/:handle/compare/:other', async (c) => {
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
    await fillV3Score(me, other, card, c.req.queries('genre'));
    const currentViewer = sessionUser(c), currentTarget = registry.userByHandle(other.handle);
    if (!currentViewer || currentViewer.id !== me.id) return c.redirect('/auth/google');
    if (!currentTarget || (!currentTarget.dashboardPublic && !mutualFriends(currentViewer, currentTarget))) return notFoundPage(c);
    if (registry.matchingCandidateByHandle(me, other.handle)) {
      card.actionToken = registry.issueMatchActionToken(me, other.id, card.disclosure.topics);
    }
    const lang = langOf(c);
    const range = comparisonRange(c.req.query('range'));
    // Consent is re-read on every request: a withdrawal takes effect on the
    // next page load.
    const [mine, theirs] = await Promise.all([
      cachedComparisonProfileFor(registry, me, range),
      cachedComparisonProfileFor(registry, other, range),
    ]);
    const comparison = compareWatchProfiles(
      mine,
      theirs,
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
      langToggle(c, lang).href,
    ));
  });


  const matchingActionError = (c: Context) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    return c.text(messages(langOf(c)).matchesActionInvalid, 400);
  };

  const comparisonAfterAction = (c: Context, me: User, actionToken: unknown, returnTo?: unknown) => {
    const candidate = registry.friendshipCandidateForAction(me, String(actionToken ?? ''));
    // A numbered directory page keeps actions on page 2+ showing that page.
    if (returnTo === '/matches' || /^\/matches\?page=[1-9]\d{0,3}$/.test(String(returnTo ?? ''))
      || (candidate && returnTo === `/${candidate.handle}`)) return c.redirect(String(returnTo));
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

  function profileCsrf(c: Context): string {
    return createHash('sha256').update('urtube-profile:' + (getCookie(c, 'urtube_session') ?? '')).digest('hex');
  }

  app.get('/account/profile', (c) => {
    c.header('Cache-Control', 'no-store');
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    return c.html(profileEditPage(me, profileCsrf(c), langOf(c), me, '', c.req.query('saved') === '1'));
  });

  app.post('/account/profile', async (c) => {
    c.header('Cache-Control', 'no-store');
    const me = sessionUser(c);
    if (!me) return c.text(langOf(c) === 'zh' ? '請重新登入後再試。' : 'Please sign in again and retry.', 401);
    const lang = langOf(c), t = profileMessages(lang);
    if (c.req.header('sec-fetch-site') === 'cross-site' ||
        (c.req.header('origin') && c.req.header('origin') !== new URL(config.publicBaseUrl).origin)) {
      return c.text(t.errors.csrf, 403);
    }
    // Bound input before parsing to avoid unbounded form uploads.
    const raw = await c.req.text();
    if (Buffer.byteLength(raw) > 100_000) return c.text(t.errors.failed, 413);
    const form = new URLSearchParams(raw);
    if (form.get('csrf') !== profileCsrf(c)) return c.text(t.errors.csrf, 403);
    const names = form.getAll('linkName'), urls = form.getAll('linkUrl'), platforms = form.getAll('linkPlatform');
    const value: ProfileInput = {
      displayName: form.get('displayName') ?? '', handle: form.get('handle') ?? '',
      bio: (form.get('bio') ?? '').replace(/\r\n?/g, '\n'),
      socialLinks: Array.from({length: Math.max(names.length, urls.length)}, (_, i) => ({name: names[i] ?? '', url: normalizeSocialUrl(platforms[i] ?? '', urls[i] ?? ''), platform: platforms[i] ?? ''})),
    };
    try {
      if (value.handle !== me.handle && form.get('confirmHandleChange') !== '1') {
        return c.html(profileEditPage(me, profileCsrf(c), lang, value, t.errors.confirm), 400);
      }
      const updated = registry.updateProfile(me.id, value);
      clearReadCaches();
      return c.redirect('/account/profile?saved=1', 303);
    } catch (error) {
      const detail = error instanceof ProfileError ? t.errors[error.reason === 'taken' ? 'taken' : error.field] : t.errors.failed;
      return c.html(profileEditPage(me, profileCsrf(c), lang, value, detail), error instanceof ProfileError && error.reason === 'taken' ? 409 : error instanceof ProfileError ? 400 : 500);
    }
  });

  app.post('/account/visibility', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const form = await c.req.parseBody();
    registry.setDashboardPublic(me.handle, form.dashboardPublic === '1');
    return c.redirect(`/account?updated=visibility&lang=${langOf(c)}#settings-privacy`);
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
      return c.redirect(`/account?updated=matching&lang=${langOf(c)}#settings-privacy`);
    } catch (error) {
      const current = registry.userByHandle(me.handle) ?? me;
      return c.html(accountPage(current, accountStateFor(current, {
        error: presentationError(error, langOf(c), 'settings'),
      }), langOf(c)), 400);
    }
  });

  app.post('/account/reference-population', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const form = await c.req.parseBody();
    registry.setReferenceOptIn(me.handle, form.referenceOptIn === '1');
    return c.redirect(`/account?updated=reference&lang=${langOf(c)}#settings-privacy`);
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
      const result = await importArchive(registry.repositoryFor(me), {
        databasePath: registry.databasePathFor(me), archive, dataKey, source: 'takeout',
      });
      registry.markCrystalDirty(me);
      clearReadCaches();
      forgetDurableReads(registry.databasePathFor(me));
      c.header('Cache-Control', 'no-store');
      return c.html(accountPage(me, accountStateFor(me, {
        takeoutResult: result,
      }), lang));
    } catch (error) {
      return renderError(presentationError(error, lang, 'takeout'));
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

  // Self-serve deletion: session plus retyping the archive's current video
  // count, GitHub-style, so a stray click cannot delete anything. deleteUser
  // refuses the instance owner, which we surface as a friendly error.
  app.post('/account/delete', async (c) => {
    const me = sessionUser(c);
    if (!me) return c.redirect('/signup');
    const lang = langOf(c);
    const t = messages(lang);
    const form = await c.req.parseBody();
    const expectedVideos = countsFor(registry.repositoryFor(me)).videos;
    const typed = String(form.confirmVideos ?? '').trim();
    if (!/^\d+$/.test(typed) || Number(typed) !== expectedVideos) {
      return c.html(accountPage(me, accountStateFor(me, { error: t.errDeleteConfirm(expectedVideos) }), lang), 400);
    }
    if (me.storageName === DEFAULT_HANDLE) {
      return c.html(accountPage(me, accountStateFor(me, { error: t.errOwnerDelete }), lang), 400);
    }
    try {
      registry.deleteUser(me.handle);
    } catch (error) {
      return c.html(accountPage(me, accountStateFor(me, {
        error: presentationError(error, lang, 'delete'),
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
    // Revalidate every fetch so a dashboard made private leaves the sitemap
    // immediately rather than after a shared cache's lifetime.
    c.header('Cache-Control', 'no-cache');
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
  app.get('/compare', async (c) => {
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
      || Boolean(registry.userByDashboardToken(user.handle, getCookie(c, `urtube_dash_id_${user.id}`) ?? getCookie(c, `urtube_dash_${user.handle}`) ?? ''));
    if (!allowed(a, 'keyA') || !allowed(b, 'keyB')) return notFoundPage(c);
    const comparison = compareCrystals(...await Promise.all([cachedMatchingCrystalFor(registry, a), cachedMatchingCrystalFor(registry, b)]));
    c.header('Cache-Control', 'no-cache');
    // Keyed compare links must not get indexed if they leak to a crawler.
    if (!a.dashboardPublic || !b.dashboardPublic) c.header('X-Robots-Tag', 'noindex');
    return c.html(comparePage(comparison, `/${a.handle}`, lang, siteNav(c, lang)));
  });

  app.get('/u/:handle/summary.json', async (c) => {
    const user = registry.userByHandle(c.req.param('handle'));
    if (!user || !dashboardAccess(c, user)) return c.json({ error: 'not found' }, 404);
    const data = await cachedDashboardFor(registry, user, requestedRange(c.req.query('range')),
      registry.repositoryFor(user), c.req.query('detail') === 'summary' ? 'summary' : true);
    return c.json({ ...data, recent: undefined });
  });

  // Private interval feed for the owner's other tools. Public dashboards do
  // not unlock it: precise timestamps stay behind the dashboard token (query
  // key, cookie, or Bearer header) or the owner's own session.
  app.get('/u/:handle/intervals.json', (c) => {
    const user = registry.userByHandle(c.req.param('handle'));
    if (!user) return c.json({ error: 'not found' }, 404);
    const auth = c.req.header('authorization') ?? '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const allowed = privateDashboardAccess(c, user)
      || Boolean(bearer && registry.userByDashboardToken(user.handle, bearer));
    if (!allowed) return c.json({ error: 'not found' }, 404);
    const sinceRaw = c.req.query('since');
    const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : null;
    if (sinceRaw && !since) return c.json({ error: 'since must be an ISO 8601 timestamp' }, 400);
    const limit = Math.max(1, Math.min(5000, Number.parseInt(c.req.query('limit') ?? '', 10) || 2000));
    const intervals = registry.repositoryFor(user).youtubeWatchIntervals({ since, limit });
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    return c.json({
      generatedAt: new Date().toISOString(),
      since,
      limit,
      // Re-read from here (inclusive) on the next pull; rows repeat by eventId.
      nextSince: intervals.length === limit ? intervals[intervals.length - 1]!.watchedAt : null,
      intervals,
    });
  });

  app.get('/api/youtube/summary.json', async (c) => {
    const user = registry.ensureDefaultUser();
    if (!dashboardAccess(c, user)) return c.json({ error: 'not found' }, 404);
    const data = await cachedDashboardFor(registry, user, requestedRange(c.req.query('range')),
      registry.repositoryFor(user), c.req.query('detail') === 'summary' ? 'summary' : true);
    return c.json({ ...data, recent: undefined });
  });

  app.get('/api/youtube/recent.json', async (c) => {
    const user = registry.ensureDefaultUser();
    if (!dashboardAccess(c, user)) return c.json({ error: 'not found' }, 404);
    const data = await cachedDashboardFor(registry, user, DEFAULT_YOUTUBE_RANGE);
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
    const viewer = sessionUser(c);
    if (!viewer) return c.json({ error: 'login_required' }, 401);
    if (!v3.adminHandles.includes(viewer.storageName)) return c.json({ error: 'admin_required' }, 403);
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
        // Approximate YouTube Data API quota units spent since the last
        // reset: the worker's and matching worker's counts from their status
        // files plus this app process's own channel-page lookups.
        apiUsage: (() => {
          const worker = readOpsStatus<WorkerOpsStatus>('worker');
          const matching = readOpsStatus<MatchingOpsStatus>('matching');
          const app = youtubeApiUsage();
          return {
            workerRequestsSinceReset: worker?.youtubeApiRequestsSinceReset ?? null,
            // A count published before the latest reset no longer applies.
            matchingRequestsSinceReset: matching?.youtubeApiQuotaResetAt === app.quotaResetAt
              ? matching.youtubeApiRequestsSinceReset ?? null : null,
            appRequestsSinceReset: app.requestsSinceReset,
            quotaResetAt: app.quotaResetAt,
          };
        })(),
      },
    });
  });

  // Healthy whenever the database answers: a freshly deployed, still-empty
  // instance must pass health checks before any data migration happens.
  app.get('/healthz', (c) => {
    try {
      const user = registry.ensureDefaultUser();
      const repository = registry.repositoryFor(user);
      repository.ping();
      return c.json({
        status: 'healthy',
        service: 'urtube',
      });
    } catch {
      return c.json({
        status: 'unhealthy',
        service: 'urtube',
      }, 503);
    }
  });

  // Production readiness is stricter than liveness: every user database must
  // open, required signup config must exist, and scheduled jobs must either
  // be live with a fresh heartbeat or have completed recently. External
  // monitoring should probe this endpoint.
  app.get('/readyz', async (c) => {
    const now = Date.now();
    const worker = readOpsStatus<WorkerOpsStatus>('worker');
    const backup = readOpsStatus<{ lastCompletedAt?: string; lastError?: string }>('backup');
    const fresh = (iso: string | undefined, maxAgeMs: number) =>
      Boolean(iso && Number.isFinite(Date.parse(iso)) && Date.parse(iso) <= now && now - Date.parse(iso) <= maxAgeMs);
    let databaseFailures = 0;
    const users = registry.listUsers();
    for (const user of users) {
      try {
        registry.repositoryFor(user).ping();
      } catch {
        databaseFailures++;
      }
    }
    const matching = v3.enabled ? registry.matchingV3Store().readiness(now) : null;
    const computeReady = readinessCompute ? await readinessCompute.ready?.().catch(() => false) ?? false : true;
    const checks = {
      config: Boolean(config.youtube.privateDataKey && (!config.signupEnabled || googleLoginConfigured())),
      databases: databaseFailures === 0,
      worker: workerOpsReady(worker, now),
      backup: fresh(backup?.lastCompletedAt, (config.backup.intervalHours + 2) * 3600_000)
        && !backup?.lastError,
      ...(matching ? { matchingWorker: matching.worker, matchingCompute: computeReady } : {}),
    };
    const ready = Object.values(checks).every(Boolean);
    return c.json({
      status: ready ? 'ready' : 'not_ready',
      checks,
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

  const profilePage = (page: YoutubeDashboardPageKind) => async (c: Context) => {
    c.header('Cache-Control', 'private, no-store');
    const user = registry.userByHandle(c.req.param('handle') ?? '');
    if (!user || !profileAccess(c, user, page)) {
      c.header('X-Robots-Tag', 'noindex');
      return notFoundPage(c);
    }
    if (page === 'history') {
      c.header('X-Robots-Tag', 'noindex');
      // profileAccess has already persisted a valid dashboard key. Always
      // remove it before rendering links, forms or a language toggle.
      if (c.req.query('key') !== undefined) {
        const clean = new URLSearchParams();
        for (const name of ['q', 'from', 'to', 'range', 'cursor', 'direction', 'lang']) {
          const value = c.req.query(name);
          if (value !== undefined) clean.set(name, value);
        }
        const query = clean.toString();
        return c.redirect(`/${user.handle}/history${query ? `?${query}` : ''}`, 302);
      }
      const lang = langOf(c);
      const input = {
        range: c.req.query('range'), q: c.req.query('q'), from: c.req.query('from'), to: c.req.query('to'),
        cursor: c.req.query('cursor'), direction: c.req.query('direction'),
      };
      let result: YoutubeHistoryPage;
      let error: 'q' | 'dates' | 'cursor' | undefined;
      try {
        const query = { ...input, range: requestedRange(input.range) };
        // Validate cheaply on this thread so field errors survive the worker
        // boundary. Archive scans run on the existing read-only pool.
        normalizeHistoryQuery(query);
        result = await readMethodOffThread(registry.repositoryFor(user), registry.databasePathFor(user),
          'youtubeHistoryPage', query, new Date());
      } catch (cause) {
        if (!(cause instanceof HistoryQueryError)) throw cause;
        error = cause.field;
        // Preserve bounded form input so the person can correct it; do not
        // run a fallback query or display unrelated results for invalid input.
        result = { entries: [], olderCursor: null, newerCursor: null, filters: {
          range: input.from || input.to ? 'all' : requestedRange(input.range),
          q: [...(input.q ?? '')].slice(0, 240).join(''),
          from: (input.from ?? '').slice(0, 10), to: (input.to ?? '').slice(0, 10),
        } };
      }
      // The session or private dashboard key may be revoked during a read.
      if (!profileAccess(c, user, 'history')) return notFoundPage(c);
      const currentUser = registry.userByHandle(user.handle)!;
      const viewerOwns = sessionUser(c)?.id === currentUser.id;
      return c.html(historyPage({
        ownerName: currentUser.displayName, profilePath: `/${currentUser.handle}`,
        profileHtml: profileDetails(currentUser, viewerOwns, lang), viewerOwns,
        nav: siteNav(c, lang, viewerOwns ? 'dashboard' : undefined), lang, result, error, hasCursor: Boolean(input.cursor),
      }), error ? 400 : 200);
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

// Cold, a public page's aggregates took up to a minute on the production host.
// Render each public page once after start, one at a time, as an anonymous
// visitor would, so the first visitor or crawler after a deploy is not the one
// waiting. Visibility is rechecked before every page.
export async function warmPublicPages(app: Hono, registry: UserRegistry): Promise<{ pages: number; ok: number }> {
  let pages = 0, ok = 0;
  for (const listed of registry.listUsers()) {
    for (const suffix of ['/insights', '']) {
      if (!registry.userByHandle(listed.handle)?.dashboardPublic) break;
      pages++;
      try {
        // The whole request, across its awaits, is background work for the
        // read pool: visitors' reads go first.
        const response = await withReadPriority({ background: true }, () => app.request(`/${listed.handle}${suffix}`));
        await response.arrayBuffer();
        if (response.status === 200) ok++;
        // Background refreshes the page started: one page's reads at a time.
        await readPoolIdle();
      } catch { /* the next visitor computes it */ }
    }
  }
  return { pages, ok };
}

if (process.env.NODE_ENV !== 'test') {
  const registry = new UserRegistry(process.env.USERS_DATABASE_PATH ?? './data/users.sqlite');
  registry.repairArchivesOnOpen = false;
  registry.ensureDefaultUser();
  const app = createApp(registry);
  outliveProxyKeepAlive(serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`urtube listening on :${info.port}`);
  }));
  watchEventLoop(() => ({ poolPending: readPoolPending() }));
  // After the start-up health checks; ingest and worker also restart on deploy.
  setTimeout(() => {
    const started = Date.now();
    void warmPublicPages(app, registry).then(({ pages, ok }) =>
      console.log(`warmed ${pages} public pages (${ok} returned 200) in ${Math.round((Date.now() - started) / 1000)} s`));
  }, 120_000).unref();
}
