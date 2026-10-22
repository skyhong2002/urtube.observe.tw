# Archive performance PR #95 — integration review, 2026-10-22

Reviewed `origin/codex/archive-performance-20260919` (`08c268b`) against
main `fba076a`. Main already contains the useful runtime changes from the
September proposal, with a newer estimator implementation from October 18.
This integration adds missing verification and an updated benchmark; it does
not change runtime queries, schema, matching, consent or provider settings.

## Retained main implementation

- The estimator builds a connection-local TEMP projection of measured events
  and a covering `(video_id, watched_jd)` index when refreshing its existing
  materialized cache. The ±301-second seek bounds candidates; the original
  absolute Julian-date difference of at most 300 seconds decides duplication.
  Offset parsing and floating-point boundary behavior remain unchanged.
- The lookup and materialization share a savepoint/read snapshot. Failed
  rebuilds retain the prior completed cache. The saved revision predates the
  refresh so a concurrent WAL commit invalidates the next read.
- Captures reconcile channel IDs for their own video. Startup, archive import
  and explicit repair retain their broader behavior.
- `/matches` already uses `rankedUserIds` for membership checks and keeps the
  current ordering, visibility checks and post-score consent/session rechecks.
- The read thread pool and the newer summary/timeline projections remain intact.

The PR's persistent expression index is superseded by the TEMP covering lookup
and would not serve the current correlated query. Its schema-14 migration is
therefore omitted. Main schema 14 belongs to the video-statistics migration;
no redundant schema-15 migration, schema assertion change or exported internal
CTE is needed. Existing completed classifications and checkpoints are retained.

## Verification

`tests/archive-performance.test.ts` adds three isolated regression checks:

- Compare every estimate against the complete pre-optimization formula,
  including five-minute boundaries and ±1 ms, widened-seek endpoints, offsets,
  fractional and invalid timestamps, measured zero/null video IDs, non-video
  events, day precision, unknown durations, saved progress, and search gaps.
  Repeated reads also match the reference.
- Upgrade a disposable schema-13 fixture through main's existing statistics
  migration, preserving every original column/row and index, with only the
  expected nullable statistics columns added.
- Reopen a disposable schema-14 fixture through writable and read-only
  repositories, preserving all data, completed matching-topic assignments,
  checkpoints and statistics. Both schema tests verify foreign keys, SQLite
  integrity and identical watch intervals after reopen.

Related existing suites cover cache invalidation, concurrent WAL writes,
failed refresh rollback, capture reconciliation, read-pool equivalence,
exports, older migrations and candidate consent/deduplication. All fixtures
are synthetic and use memory or temporary databases. The isolated verification
run disables external `fetch`; provider mocks still run locally.

The final offline selection passed 29 tests across archive performance, watch
performance, watch time, export, migration, popularity, read cache and read pool,
with no skips. TypeScript checking passed. A broader candidate-list run exposed
an unrelated exact-header assertion during simultaneous PR #94 integration
(`no-store` versus the stronger `private, no-store`); it is recorded in the
parent handoff rather than weakening the new response policy.

## Reproducible synthetic benchmark

Run `NODE_ENV=test node --import tsx scripts/benchmark-archive.ts`.
The script creates and removes its own temporary SQLite files. It ignores
configured database paths, does not load credentials, and makes no network
requests. For 250, 500, 1,000 and 2,000 events, it checks both distinct-video
and repeated-video distributions with 10% measured events ten minutes apart.

Each path warms once and reports five-sample medians. The baseline replaces
only the measured-neighbor probe with its original form and materializes the
same output and indexes. The current path runs the real complete cache rebuild,
including freshness aggregates and TEMP lookup construction/removal. Every
output row/column is compared and the query plan must use both lookup columns.

Observed on Node 24.15.0 / SQLite 3.51.3 on the shared development host:

| Events | Distribution | Legacy rebuild | Current rebuild | Ratio |
| ---: | --- | ---: | ---: | ---: |
| 250 | Same video | 10.31 ms | 1.52 ms | 6.80× |
| 500 | Same video | 38.75 ms | 1.94 ms | 19.95× |
| 1,000 | Same video | 149.69 ms | 3.54 ms | 42.24× |
| 2,000 | Same video | 551.70 ms | 8.46 ms | 65.23× |
| 250 | Distinct videos | 1.18 ms | 1.53 ms | 0.77× |
| 500 | Distinct videos | 3.23 ms | 4.17 ms | 0.78× |
| 1,000 | Distinct videos | 3.82 ms | 3.71 ms | 1.03× |
| 2,000 | Distinct videos | 7.00 ms | 10.58 ms | 0.66× |

All eight scenarios matched exactly. The distinct-video results expose the
lookup/freshness overhead when the old same-video scan was already cheap;
this is not a claim of universal speedup or production latency. The existing
`scripts/benchmark-watch-neighbors.ts --edge-cases` additionally exercises
nearby measurements and archives containing only measured events.
Both edge cases matched: 2,000 unmeasured plus 2,000 nearby measured events
took 760.61/22.94 ms legacy/current, while 2,000 entirely measured events took
10.52/14.98 ms, exposing the lookup overhead when no estimate needs a probe.

The reported probe is `SEARCH measured USING COVERING INDEX
youtube_measured_video_time_idx (video_id=? AND watched_jd>? AND watched_jd<?)`.
TEMP storage and rebuild costs remain proportional to the synthetic archive.
No production database, service, worker, backfill or deployment was changed.
