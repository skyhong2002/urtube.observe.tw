// Synthetic, reproducible value funnel over the real app (#92 R18).
//
// signup -> import -> first trustworthy insight -> discovery opt-in ->
// match candidate -> invite -> accept, driven through createApp /
// createIngestApp HTTP routes against in-memory registries.
//
// Every person, video, channel and decision here is invented. Acceptance is a
// planted policy (accept when the inviter shares the synthetic community), so
// the acceptance rate measures the policy plus the ranking, not people.
// Nothing is sent anywhere: outbound fetch is blocked for the whole run.
import { load } from 'cheerio';
import { performance } from 'node:perf_hooks';
import { createApp } from '../../src/index.js';
import { config } from '../../src/config.js';
import { createIngestApp } from '../../src/ingest.js';
import { UserRegistry, type User } from '../../src/users.js';
import { classifyYoutubeVideosForMatching, MATCHING_TOPIC_MIN_COVERAGE } from '../../src/youtube/matching.js';
import { registryCrystalEligible } from '../../src/youtube/registry-crystal.js';
import type { TagListSnapshot } from '../../src/youtube/taglists.js';
import type { YoutubeVideoMetadata } from '../../src/youtube/types.js';
import { runYoutubeWorkerCycle, type YoutubeWorkerSteps } from '../../src/youtube-worker.js';
import { seededRandom } from './metrics.js';

export const FUNNEL_VERSION = 'synthetic-funnel-v1' as const;
export const FUNNEL_STEPS = ['signup', 'import', 'first-insight', 'opt-in', 'match-candidate', 'invite', 'accept'] as const;
export type FunnelStep = typeof FUNNEL_STEPS[number];

// YouTube category ids the app maps to its legacy matching taxonomy.
const COMMUNITIES = [
  { key: 'music', categoryId: '10' },
  { key: 'gaming', categoryId: '20' },
  { key: 'learning', categoryId: '27' },
] as const;

export interface FunnelOptions {
  users?: number;
  seed?: number;
  watchesPerUser?: number;
  activeDays?: number;
  now?: () => Date;
  // Planted invitee behaviour. 'decline-all' exercises the decline path.
  acceptPolicy?: 'same-community' | 'decline-all';
}

export interface FunnelUserTrace {
  handle: string;
  community: string;
  reached: FunnelStep[];
  failedAt: FunnelStep | null;
  failure: string | null;
  // Wall-clock ms from the start of signup until the first insight was confirmed.
  timeToFirstValueMs: number | null;
  // HTTP requests plus worker cycles until the first insight (deterministic).
  actionsToFirstValue: number | null;
  topCandidateSameCommunity: boolean | null;
  invited: string | null;
  invitationOutcome: 'accepted' | 'declined' | null;
}

export interface FunnelReport {
  provenance: { funnelVersion: typeof FUNNEL_VERSION; seed: number; users: number; watchesPerUser: number; activeDays: number;
    acceptPolicy: NonNullable<FunnelOptions['acceptPolicy']>;
    node: string; outboundFetchBlocked: true; note: string };
  steps: Array<{ step: FunnelStep; eligible: number; succeeded: number; rate: number | null }>;
  timeToFirstValueMs: { median: number | null; max: number | null };
  actionsToFirstValue: { median: number | null; max: number | null };
  topCandidateSameCommunityRate: number | null;
  invitationAcceptanceRate: number | null;
  unverified: string[];
  users: FunnelUserTrace[];
}

const noTagLists = async (): Promise<TagListSnapshot> => ({
  lists: { news: new Set(), editorial: new Set(), editorialShows: new Set(), blue: new Set(), green: new Set(), white: new Set(), red: new Set() },
  provenance: { sourceUrl: 'synthetic-funnel', sourceUpdatedAt: '2026-01-01 00:00:00', fetchedAt: '2026-01-01T00:00:00.000Z',
    membershipVersion: 'synthetic-funnel', policyVersion: 'synthetic-funnel', policyUrl: '/docs/channel-tag-policy.md', reportUrl: 'https://example.invalid/' },
});

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// The signup throttle is per client IP and process-wide; give every synthetic
// signup its own documentation-range address (RFC 5737) so runs stay independent.
let syntheticAddress = 0;
const nextAddress = () => {
  syntheticAddress++;
  return `198.51.${100 + Math.floor(syntheticAddress / 250) % 50}.${1 + syntheticAddress % 250}`;
};

function form(values: Record<string, string>, cookie: string, extra: Record<string, string> = {}): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: new URL(config.publicBaseUrl).origin, cookie, ...extra },
    body: new URLSearchParams(values).toString() };
}

export async function runSyntheticFunnel(options: FunnelOptions = {}): Promise<FunnelReport> {
  const userCount = options.users ?? 6;
  const seed = options.seed ?? 20261022;
  const watchesPerUser = options.watchesPerUser ?? 240;
  const activeDays = options.activeDays ?? 20;
  const now = options.now ?? (() => new Date());
  const acceptPolicy = options.acceptPolicy ?? 'same-community';
  if (userCount < 2) throw new Error('The funnel needs at least two synthetic users');
  const random = seededRandom(seed);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    throw new Error(`Synthetic funnel blocked an outbound request to ${String(input)}`);
  }) as typeof fetch;
  const registry = new UserRegistry(':memory:');
  try {
    const app = createApp(registry, { loadTagLists: noTagLists });
    const ingest = createIngestApp(registry);
    // Synthetic public metadata per video id: the offline stand-in for the
    // YouTube Data API. Real worker stages (matching classification, crystal
    // projection, registry publication) run unchanged.
    const metadata = new Map<string, YoutubeVideoMetadata>();
    const videosByUser = new Map<number, string[]>();
    const steps: YoutubeWorkerSteps = {
      portability: async () => { throw new Error('Data Portability is not part of the synthetic funnel'); },
      metadata: async (repository, user) => {
        const rows = (videosByUser.get(user.id) ?? []).map((id) => metadata.get(id)!);
        repository.upsertYoutubeVideoMetadata(rows, now().toISOString());
        return rows.length;
      },
      channelMetadata: async () => 0,
      matchingClassification: async (repository) => classifyYoutubeVideosForMatching(repository, 5000),
      classification: async () => 0,
    };

    const traces: FunnelUserTrace[] = [];
    const sessions = new Map<string, string>();
    const users = new Map<string, User>();
    for (let index = 0; index < userCount; index++) {
      const community = COMMUNITIES[index % COMMUNITIES.length];
      const handle = `synthetic-${String(index + 1).padStart(2, '0')}`;
      const trace: FunnelUserTrace = { handle, community: community.key, reached: [], failedAt: null, failure: null,
        timeToFirstValueMs: null, actionsToFirstValue: null, topCandidateSameCommunity: null, invited: null, invitationOutcome: null };
      traces.push(trace);
      const fail = (step: FunnelStep, reason: string) => { trace.failedAt = step; trace.failure = reason; };
      const started = performance.now();
      let actions = 0;

      // 1. Signup. The Google OAuth hop cannot run offline; a verified pending
      // signup (what the OAuth callback stores) stands in for it.
      const pending = registry.createPendingSignup(`synthetic-sub-${seed}-${index}`, `${handle}@example.invalid`);
      const signup = await app.request('/signup', form({ handle, displayName: `Synthetic ${index + 1}` },
        `urtube_signup=${pending}`, { 'x-forwarded-for': nextAddress() }));
      actions++;
      const sessionCookie = signup.headers.getSetCookie().find((c) => c.startsWith('urtube_session='))?.split(';')[0];
      if (signup.status !== 302 || signup.headers.get('location') !== '/onboarding' || !sessionCookie) {
        fail('signup', `HTTP ${signup.status}`); continue;
      }
      trace.reached.push('signup');
      sessions.set(handle, sessionCookie);
      const user = registry.userByHandle(handle)!;
      users.set(handle, user);

      // 2. Import via the extension provisioning flow and the history endpoint.
      const provision = await app.request('/extension-setup/token', { method: 'POST', headers: { cookie: sessionCookie, origin: new URL(config.publicBaseUrl).origin } });
      actions++;
      const token = provision.ok ? (await provision.json() as { token?: string }).token : undefined;
      if (!token) { fail('import', `token HTTP ${provision.status}`); continue; }
      const pool = Array.from({ length: 40 }, (_, i) => `S${community.key.slice(0, 2).toUpperCase()}${String(i).padStart(8, '0')}`);
      const events = [];
      const nowMs = now().getTime();
      for (let i = 0; i < watchesPerUser; i++) {
        const videoId = pool[Math.floor(pool.length * random() ** 1.5)];
        const channel = Number(videoId.slice(-2)) % 6;
        const day = 1 + (i % activeDays) * 2;
        metadata.set(videoId, { videoId, title: `Synthetic ${community.key} video ${videoId}`,
          channelId: `UCsynthetic-${community.key}-${channel}`, channelTitle: `Synthetic ${community.key} channel ${channel}`,
          description: '', tags: [], thumbnailUrl: '', durationSeconds: 600, publishedAt: null,
          categoryId: community.categoryId, availability: 'available', metadataHash: `synthetic-${videoId}` });
        events.push({ kind: 'watch', occurredAt: new Date(nowMs - day * 86_400_000 - i * 60_000).toISOString(), videoId,
          title: `Synthetic ${community.key} video ${videoId}`, url: `https://www.youtube.com/watch?v=${videoId}`,
          channelId: `UCsynthetic-${community.key}-${channel}`, channelTitle: `Synthetic ${community.key} channel ${channel}`,
          durationSeconds: 600, activityType: 'video' });
      }
      videosByUser.set(user.id, [...new Set(events.map((event) => event.videoId))]);
      let imported = 0, importError = '';
      for (let offset = 0; offset < events.length; offset += 100) {
        const response = await ingest.request('/api/ingest/youtube/history', { method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ syncId: `synthetic-${seed}-${index}-${offset}`.padEnd(16, '0'), observedAt: now().toISOString(),
            events: events.slice(offset, offset + 100) }) });
        actions++;
        if (!response.ok) { importError = `history HTTP ${response.status}: ${await response.text()}`; break; }
        imported += (await response.json() as { watchesInserted: number }).watchesInserted;
      }
      if (importError || imported === 0) { fail('import', importError || 'no watches inserted'); continue; }
      trace.reached.push('import');

      // 3. First trustworthy insight: one real worker cycle publishes the
      // matching crystal; it must pass the app's own eligibility gate and the
      // owner's dashboard must render.
      const cycle = await runYoutubeWorkerCycle(registry, steps, now, { userIds: [user.id] });
      actions++;
      if (cycle[0]?.error) { fail('first-insight', cycle[0].error.split('\n')[0]); continue; }
      const crystal = registry.matchingCrystalFor(handle);
      const dashboard = await app.request(`/${handle}`, { headers: { cookie: sessionCookie } });
      actions++;
      if (!crystal || !registryCrystalEligible(crystal) || crystal.data.topicCoverage < MATCHING_TOPIC_MIN_COVERAGE || dashboard.status !== 200) {
        fail('first-insight', `crystal ${crystal ? 'present' : 'missing'}, coverage ${crystal?.data.topicCoverage ?? 0}, dashboard HTTP ${dashboard.status}`);
        continue;
      }
      trace.reached.push('first-insight');
      trace.timeToFirstValueMs = Math.round(performance.now() - started);
      trace.actionsToFirstValue = actions;

      // 4. Explicit discovery opt-in through onboarding (only reachable after
      // the app considers the matching data eligible).
      const finish = await app.request('/onboarding/finish', form({ preferencesSubmitted: '1', matchingOptIn: '1' }, sessionCookie));
      if (finish.status !== 302 || finish.headers.get('location') !== '/matches') {
        fail('opt-in', `HTTP ${finish.status} -> ${finish.headers.get('location')}`); continue;
      }
      trace.reached.push('opt-in');
    }

    // 5-6. Candidates and invitations, after everyone had the chance to opt in.
    // Even-indexed people invite their highest-ranked candidate they have no
    // relationship with; odd-indexed people only respond.
    const byHandle = new Map(traces.map((trace) => [trace.handle, trace]));
    for (const [index, trace] of traces.entries()) {
      if (trace.failedAt) continue;
      const cookie = sessions.get(trace.handle)!;
      const page = load(await (await app.request('/matches', { headers: { cookie } })).text());
      const cards = page('.mt-card').toArray().map((el) => ({
        handle: (page(el).find('.mt-person-link').attr('href') ?? '').replace(/^\//, ''),
        token: page(el).find('form[action="/matches/request"] [name=actionToken]').attr('value') ?? null,
      })).filter((card) => byHandle.has(card.handle));
      if (!cards.length) { trace.failedAt = 'match-candidate'; trace.failure = 'no candidate cards'; continue; }
      trace.reached.push('match-candidate');
      trace.topCandidateSameCommunity = byHandle.get(cards[0].handle)!.community === trace.community;
      if (index % 2 === 1) continue;
      const target = cards.find((card) => card.token);
      if (!target) { trace.failedAt = 'invite'; trace.failure = 'no invitable card'; continue; }
      const sent = await app.request('/matches/request', form({ actionToken: target.token!, returnTo: '/matches' }, cookie));
      const me = users.get(trace.handle)!, other = users.get(target.handle)!;
      if (sent.status !== 302 || registry.matchingRelationshipFor(me, other.id).status === 'none') {
        trace.failedAt = 'invite'; trace.failure = `HTTP ${sent.status}`; continue;
      }
      trace.reached.push('invite');
      trace.invited = target.handle;
    }

    // 7. The invitee answers from the inviter's profile page. Planted policy:
    // accept when the inviter shares the synthetic community, else decline.
    for (const trace of traces.filter((t) => t.invited)) {
      const invitee = byHandle.get(trace.invited!)!;
      const cookie = sessions.get(invitee.handle)!;
      const profile = load(await (await app.request(`/${trace.handle}`, { headers: { cookie } })).text());
      const respond = profile('form[action="/matches/respond"]').first();
      const actionToken = respond.find('[name=actionToken]').attr('value');
      const requestToken = respond.find('[name=requestToken]').attr('value');
      if (!actionToken || !requestToken) { trace.failedAt = 'accept'; trace.failure = 'invitee sees no response form'; continue; }
      const accept = acceptPolicy === 'same-community' && invitee.community === trace.community;
      const answered = await app.request('/matches/respond', form({ actionToken, requestToken, response: accept ? 'accept' : 'decline', returnTo: '/matches' }, cookie));
      const relationship = registry.matchingRelationshipFor(users.get(trace.handle)!, users.get(invitee.handle)!.id).status;
      if (answered.status !== 302) { trace.failedAt = 'accept'; trace.failure = `HTTP ${answered.status}`; continue; }
      trace.invitationOutcome = accept ? 'accepted' : 'declined';
      if (accept) {
        // Value unlocked: the new friend's Insights page is now readable.
        const insights = await app.request(`/${invitee.handle}/insights`, { headers: { cookie: sessions.get(trace.handle)! } });
        if (relationship !== 'connected' || insights.status !== 200) {
          trace.failedAt = 'accept'; trace.failure = `relationship ${relationship}, insights HTTP ${insights.status}`; continue;
        }
        trace.reached.push('accept');
      } else if (relationship !== 'none') {
        trace.failedAt = 'accept'; trace.failure = `decline left relationship ${relationship}`;
      }
    }

    const stepRows = FUNNEL_STEPS.map((step, i) => {
      const previous = i === 0 ? null : FUNNEL_STEPS[i - 1];
      // Only even-indexed people invite; every sent invitation is eligible for
      // acceptance, so the accept rate is the (planted) acceptance rate.
      const pool = traces.filter((t, index) => (previous === null || t.reached.includes(previous))
        && (step !== 'invite' || index % 2 === 0));
      const succeeded = pool.filter((t) => t.reached.includes(step)).length;
      return { step, eligible: pool.length, succeeded, rate: pool.length ? succeeded / pool.length : null };
    });
    const ttfv = traces.flatMap((t) => t.timeToFirstValueMs === null ? [] : [t.timeToFirstValueMs]);
    const actionsTtfv = traces.flatMap((t) => t.actionsToFirstValue === null ? [] : [t.actionsToFirstValue]);
    const tops = traces.filter((t) => t.topCandidateSameCommunity !== null);
    const answered = traces.filter((t) => t.invitationOutcome);
    return {
      provenance: { funnelVersion: FUNNEL_VERSION, seed, users: userCount, watchesPerUser, activeDays, acceptPolicy, node: process.version,
        outboundFetchBlocked: true,
        note: 'Synthetic users on in-memory registries; Google OAuth and YouTube metadata are offline stand-ins; acceptance is a planted policy.' },
      steps: stepRows,
      timeToFirstValueMs: { median: median(ttfv), max: ttfv.length ? Math.max(...ttfv) : null },
      actionsToFirstValue: { median: median(actionsTtfv), max: actionsTtfv.length ? Math.max(...actionsTtfv) : null },
      topCandidateSameCommunityRate: tops.length ? tops.filter((t) => t.topCandidateSameCommunity).length / tops.length : null,
      invitationAcceptanceRate: answered.length ? answered.filter((t) => t.invitationOutcome === 'accepted').length / answered.length : null,
      unverified: [
        'Real time-to-first-value: dominated by extension history scans, YouTube Data API quota and worker cadence, none simulated here.',
        'Real invitation acceptance: the synthetic rate follows a planted rule, not people.',
        'Perceived relevance of recommendations: needs consented human feedback.',
        'Long-term effects (lasting friendships, continued conversation, retention): unverified; no data is collected.',
      ],
      users: traces,
    };
  } finally {
    registry.close();
    globalThis.fetch = originalFetch;
  }
}

export function formatFunnelReport(report: FunnelReport): string {
  const pct = (value: number | null) => value === null ? 'n/a' : `${(100 * value).toFixed(0)}%`;
  const lines = ['# urtube synthetic value funnel', '',
    '> Synthetic run over the real app routes. These numbers verify that the funnel works end to end;',
    '> they are NOT measurements of real demand, acceptance, or long-term value.', '',
    `- ${report.provenance.funnelVersion}, seed ${report.provenance.seed}, ${report.provenance.users} users x ${report.provenance.watchesPerUser} watches over ${report.provenance.activeDays} days, accept policy ${report.provenance.acceptPolicy}, Node ${report.provenance.node}`,
    `- outbound network blocked: ${report.provenance.outboundFetchBlocked}; ${report.provenance.note}`, '',
    '| step | reached / eligible | rate |', '| --- | --- | --- |',
    ...report.steps.map((s) => `| ${s.step} | ${s.succeeded} / ${s.eligible} | ${pct(s.rate)} |`), '',
    `- time to first trustworthy insight (synthetic, wall-clock): median ${report.timeToFirstValueMs.median ?? 'n/a'} ms, max ${report.timeToFirstValueMs.max ?? 'n/a'} ms`,
    `- actions to first insight (HTTP requests + worker cycles): median ${report.actionsToFirstValue.median ?? 'n/a'}, max ${report.actionsToFirstValue.max ?? 'n/a'}`,
    `- top candidate shares the synthetic community: ${pct(report.topCandidateSameCommunityRate)}`,
    `- invitation acceptance under the planted policy: ${pct(report.invitationAcceptanceRate)}`, '',
    'Unverified (not measured by this run):', ...report.unverified.map((item) => `- ${item}`)];
  const failures = report.users.filter((u) => u.failedAt);
  if (failures.length) lines.push('', 'Failures:', ...failures.map((u) => `- ${u.handle}: ${u.failedAt} (${u.failure})`));
  return `${lines.join('\n')}\n`;
}
