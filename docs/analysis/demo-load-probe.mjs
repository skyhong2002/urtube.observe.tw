// Synthetic, in-memory Repository probe; never connects to deployment databases.
// Run: node --import tsx docs/analysis/demo-load-probe.mjs
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.USERS_DATABASE_PATH = ':memory:';
const { Repository } = await import('../../src/data/database.ts');
const { cachedRead, clearReadCaches } = await import('../../src/data/read-cache.ts');
const { buildYoutubeCrystal } = await import('../../src/youtube/crystal.ts');
const { PERSONAL_TOPICS } = await import('../../src/youtube/personal-taxonomy.ts');
const { MATCHING_TAXONOMY } = await import('../../src/youtube/matching.ts');
const now = new Date('2026-09-06T00:00:00.000Z'), n = 20000, channelCount = 2000;
const repo = new Repository(':memory:'), db = repo.db;
const observed = {
    node: process.version,
    sqlite: db.prepare('SELECT sqlite_version() v').get().v,
    cpu: cpus()[0].model,
    fixture: {
        videos: n, watches: n, channels: channelCount, historyDays: 730,
        searches: 0, actualSeconds: null, tagsPerVideo: 8,
        seed: 'deterministic short synthetic metadata; fixed 8 tags; 14 assigned topics',
    },
    measurements: [],
};
function measure(name, fn, trials = 3) {
    const samples = [];
    let value;
    for (let i = 0; i < trials; i++) {
        const start = performance.now();
        value = fn();
        samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    observed.measurements.push({
        name,
        medianMs: +samples[Math.floor(trials / 2)].toFixed(3),
        samplesMs: samples.map(v => +v.toFixed(3)),
    });
    return value;
}
db.exec('BEGIN');
const channel = db.prepare("INSERT INTO youtube_channels(channel_id,name,thumbnail_url,metadata_fetched_at) VALUES (?,?,'',?)");
for (let i = 0; i < channelCount; i++)
    channel.run('UC' + String(i).padStart(22, '0'), 'Synthetic channel ' + i, now.toISOString());
const topic = db.prepare("INSERT INTO youtube_topics(taxonomy_version,slug,name,description,created_at) VALUES (1,?,?,?,?)");
for (const t of PERSONAL_TOPICS)
    topic.run(t.slug, t.name, t.description, now.toISOString());
db.prepare("INSERT INTO youtube_taxonomy_runs(taxonomy_version,definition_version,status,model,prompt_version,created_at,input_videos,category_count) VALUES (1,'personal-fixed-v2','active','synthetic','youtube-topics-v2',?,?,14)").run(now.toISOString(), n);
const video = db.prepare("INSERT INTO youtube_videos(video_id,title,channel_id,channel_title,duration_seconds,description,tags_json,availability,metadata_hash,metadata_fetched_at) VALUES (?,?,?,?,600,?,?,'available','synthetic',?)");
const activity = db.prepare("INSERT INTO activities(id,dedupe_key,source,type,media_kind,title,image,occurred_at,occurred_precision,visibility,extra_json,first_seen_at,last_seen_at) VALUES (?,?,'youtube','watch','video','synthetic','',?,'exact','summary','{}',?,?)");
const watch = db.prepare("INSERT INTO youtube_watch_events(event_id,activity_id,video_id,watched_at,raw_title,raw_url,imported_at,activity_type,channel_id,channel_title) VALUES (?,?,?,?,'synthetic','https://example.invalid',?,'video',?,?)");
const assign = db.prepare("INSERT INTO youtube_video_topics(video_id,topic_id,rank,confidence,model,prompt_version,metadata_hash,classified_at) VALUES (?,?,1,0.95,'synthetic','youtube-topics-v2','synthetic',?)");
const match = db.prepare("INSERT INTO youtube_video_matching_topics(video_id,taxonomy_version,topic_key,metadata_hash,classified_at) VALUES (?,1,?,'synthetic',?)");
for (let i = 0; i < n; i++) {
    const id = String(i), vid = 'v' + id, ci = i % channelCount, cid = 'UC' + String(ci).padStart(22, '0'), date = new Date(now.getTime() - 730 * 86400000 + (i + 1) * 730 * 86400000 / (n + 1)).toISOString();
    video.run(vid, 'Synthetic science music cooking lecture ' + id, cid, 'Synthetic channel ' + ci, 'Synthetic public description for a lecture.', JSON.stringify(['science', 'music', 'cooking', 'lecture', 'education', 'technology', 'travel', 'creative']), now.toISOString());
    activity.run(id, id, date, date, date);
    watch.run(id, id, vid, date, date, cid, 'Synthetic channel ' + ci);
    assign.run(vid, i % 14 + 1, now.toISOString());
    match.run(vid, MATCHING_TAXONOMY.topics[i % 14].key, now.toISOString());
}
db.exec('COMMIT');
observed.mainLogicalBytes = Number(db.prepare('PRAGMA page_count').get().page_count) * Number(db.prepare('PRAGMA page_size').get().page_size);
measure('source_limit_2000', () => repo.matchingV3Source(2000));
measure('source_limit_20000', () => repo.matchingV3Source(20000));
measure('estimated_events_rebuild', () => {
    // Deliberately invalidate the internal TEMP cache in this synthetic probe.
    repo.estimatedEventsBuiltAt = 0;
    repo.estimatedEventsRevision = '';
    repo.ensureEstimatedEvents();
});
observed.tempLogicalBytes = Number(db.prepare('PRAGMA temp.page_count').get().page_count) * Number(db.prepare('PRAGMA temp.page_size').get().page_size);
measure('channel_totals_90d_temp_warm', () => repo.youtubeChannelTotals('90d', now));
measure('channel_totals_all_temp_warm', () => repo.youtubeChannelTotals('all', now));
measure('channel_detail_all_temp_warm', () => repo.youtubeChannelDetail('UC' + String(0).padStart(22, '0'), 'all', now));
measure('dashboard_base_28d_temp_warm', () => repo.youtubeDashboard('28d', now, false));
measure('dashboard_overview_28d_temp_warm', () => repo.youtubeDashboard('28d', now, 'overview'));
measure('dashboard_insights_all_temp_warm', () => repo.youtubeDashboard('all', now, true));
measure('comparison_profile_all_temp_warm', () => repo.youtubeComparisonProfile(1, 'all', now));
measure('build_crystal_temp_warm', () => buildYoutubeCrystal(repo, { handle: 'synthetic', displayName: 'Synthetic' }, now));
clearReadCaches();
cachedRead(repo, 'synthetic_overview', () => repo.youtubeDashboard('28d', now, 'overview'));
measure('cached_overview_read_only', () => cachedRead(repo, 'synthetic_overview', () => { throw Error('Expected hot cache'); }), 5);
const text = readFileSync(new URL('../../src/data/database.ts', import.meta.url), 'utf8');
const placeholderSource = text.match(/const selectDayPlaceholders = this.db.prepare\(`([\s\S]*?)`\)/);
if (!placeholderSource) throw new Error('Placeholder query changed; update the synthetic probe.');
const ph = placeholderSource[1];
const query = db.prepare(ph);
measure('100_placeholder_queries_20k_existing', () => {
    for (let i = 0; i < 100; i++) query.all('v' + i, '2026-09-05');
});
observed.placeholderPlan = db.prepare('EXPLAIN QUERY PLAN ' + ph).all('v0', '2026-09-05');
measure('capture_backfill_all_channels_known', () => repo.backfillYoutubeChannelIds());
measure('capture_backfill_one_video', () => repo.backfillYoutubeChannelIds(['v0']));
// Index-only experiment inside this synthetic database, matching the original query expressions exactly.
db.exec("CREATE INDEX probe_identity_day ON youtube_watch_events(COALESCE(video_id, NULLIF(raw_url, ''), raw_title),strftime('%Y-%m-%d', watched_at, '+8 hours'))");
const indexed = db.prepare(ph);
measure('100_placeholder_queries_expression_index', () => {
    for (let i = 0; i < 100; i++) indexed.all('v' + i, '2026-09-05');
});
observed.indexedPlaceholderPlan = db.prepare('EXPLAIN QUERY PLAN ' + ph).all('v0', '2026-09-05');
observed.peakRssKiB = process.resourceUsage().maxRSS;
repo.close();
process.stdout.write(JSON.stringify(observed, null, 2) + '\n');
