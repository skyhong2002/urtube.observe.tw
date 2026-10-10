# Archive and candidate-list performance — 2026-09-19

This independent PR addresses audit items P01–P03. P04 (lightweight health probes) is in #94.

The watch-time estimator formerly searched a video's measured events repeatedly using only the original absolute time-difference predicate. Schema 14 adds a partial expression index over video ID and `julianday(watched_at)` for measured rows. A 301-second indexed prefilter narrows the candidates; the existing 300-second absolute-difference predicate still makes the final decision. The extra second avoids altering floating-point boundary behavior. Different time-zone representations use the same SQLite conversion as before.

Single-video captures now reconcile missing channel IDs only for that video; archive import, startup reconciliation and the explicit repair method keep their broader behavior. Candidate-list membership uses an ID Set while retaining existing ordering, rechecks and scoring.

## Verification

- TypeScript and 410 Node tests passed with the isolated numerical service; none skipped.
- New tests compare every estimated result to the original predicate at five-minute boundaries, fractional seconds, UTC offsets, mixed measured events and day precision, and verify the query plan uses both index columns.
- Migration from schema 13 preserves all stored table contents, works across reopen and only adds the index. Capture reconciliation and repeated ingestion remain covered.
- `NODE_ENV=test npx tsx scripts/benchmark-archive.ts` creates disposable synthetic databases, checks identical results, warms each query and reports five-sample medians. It never opens configured production archives.

Measured locally on Node 26.5.0 / SQLite 3.53.4, with 10% measured events and events ten minutes apart:

| Events, same video | Before | After | Ratio |
| ---: | ---: | ---: | ---: |
| 250 | 7.94 ms | 0.62 ms | 12.7× |
| 500 | 31.33 ms | 1.37 ms | 22.8× |
| 1,000 | 115.37 ms | 2.74 ms | 42.1× |
| 2,000 | 433.73 ms | 5.64 ms | 76.9× |

The distinct-video case changed from 6.21 to 5.80 ms at 2,000 events. These are isolated query timings, not full-page or production latency promises; all eight measured scenarios returned identical results.

## Migration and limits

The index is built on first open after deployment and costs temporary write-lock time and additional disk space in proportion to measured events. No classification backfill or cache reset is performed. Existing time indexes remain. Reverting this code can leave the additive index in place; do not delete archive data or lower schema versions during rollback. Large production archives still need a measured rollout window and representative capacity testing.

No production databases, deployments, provider budgets or worker scheduling were changed for this PR. Sources for index behavior: [SQLite expression indexes](https://www.sqlite.org/expridx.html) and [partial indexes](https://www.sqlite.org/partialindex.html).
