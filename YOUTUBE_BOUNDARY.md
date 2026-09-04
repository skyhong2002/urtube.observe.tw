# YOUTUBE_BOUNDARY — what moves from Infovore to urtube, and what does not

urtube is a standalone, private YouTube attention archive extracted from
Infovore. This document is the authoritative boundary: which code, data, and
credentials cross over, and which stay behind.

## Topology

| Role | Host / path |
|---|---|
| Development | `ssh skyhong-SM`, `/home/deck/Projects/urtube` |
| Production | `ssh SkyLabMac` (140.113.240.11), `/Users/skyhong/Projects/urtube`, Docker via colima, Caddy at `/usr/local/etc/caddy/Caddyfile` |
| Public URL | `https://urtube.observe.tw` |
| Old data source | `ssh skyhong.tw` — Infovore production docker volume (`infovore-data`, SQLite at `/data/infovore.sqlite`) |

## Code that moves (extracted, renamed, no Infovore imports)

| Infovore | urtube | Notes |
|---|---|---|
| `src/youtube/*` (takeout, capture, history-sync, progress, metadata, keywords, ai, portability, crypto, types) | `src/youtube/*` | Verbatim semantics. |
| `src/data/database.ts` | `src/data/database.ts` | Same SQLite schema and migration chain (`user_version` 1–8) so a restored Infovore database opens unchanged. Non-YouTube repository methods (source sync, time ledger, stats.fm, backloggd) are dropped; their tables remain in the schema for restore compatibility. |
| `src/data/activity.ts`, `src/data/time.ts`, `src/data/types.ts` | same | Needed by the YouTube ingestion path (`activities` rows with `visibility='summary'`). |
| `src/ingest.ts` | `src/ingest.ts` | YouTube endpoints only. The generic `/api/ingest/events` endpoint **stays in Infovore** — it is not YouTube data. |
| `src/index.ts` (YouTube routes) | `src/index.ts` | Dashboard at `/youtube` (was `/platforms/youtube`), `/api/youtube/summary.json`, `/api/youtube/recent.json`, `/status`, `/healthz`. |
| `src/output/youtube.ts` | `src/output/youtube.ts` | HTML dashboard. The satori/resvg SVG **cards are not extracted** (Infovore-site presentation; drops heavy native deps from the image). |
| `src/youtube-worker.ts`, `src/import-youtube.ts`, `src/youtube-topics.ts` | same | Scheduled worker, Takeout CLI, taxonomy rebuild CLI. |
| `chrome-extension/*` | `chrome-extension/*` | All `infovore` identifiers renamed to `urtube`; endpoint and host permissions point at `urtube.observe.tw`; dashboard content script matches `https://urtube.observe.tw/youtube*`. |
| `tests/youtube.test.ts`, `tests/extension.test.js` | ported | Plus new ingest-auth, privacy, and migration-verification tests. |

## Code that stays in Infovore

Everything else: Backloggd/Kitsu/stats.fm/Simkl/Goodreads sources, cards
rendering, MCP server, RSS/home/profile/wrapped pages, manual events, time
ledger. Infovore keeps running; only its YouTube ingestion gets disabled at
cutover (see CUTOVER_RUNBOOK.md).

## Data that moves (YouTube tables only — decided)

The Infovore production database contains other platforms' data. **Only the
YouTube subset is migrated**; the full database is never exposed to urtube.
`scripts/migrate-from-infovore.ts` copies, via `ATTACH`, exactly:

- `activities` rows `WHERE source='youtube'` (all are `visibility='summary'`)
- `youtube_imports`
- `youtube_videos`, `youtube_channels`
- `youtube_watch_events`, `youtube_search_events`
- `youtube_topics`, `youtube_video_topics`
- `youtube_progress_imports`, `youtube_video_progress`
- `youtube_sync_state` (Data Portability checkpoint)
- `youtube_oauth` (encrypted refresh token; see key note below)

Not copied: `snapshots`, `sync_runs`, `time_ledger*`, non-YouTube
`activities`, `youtube_oauth_states` (transient CSRF states).

After migration, urtube creates `youtube_video_matching_topics` additively and
the worker rebuilds it from public video metadata; Infovore has no source table
for these versioned canonical classifications.

The multi-user registry has a separate `crystals` table containing only the
bounded matching projection, plus `crystal_refresh_queue` and an opt-in flag.
Identity is joined by `user_id`; it is not copied into crystal JSON. Foreign
keys cascade these shared rows on account deletion. These registry tables are
included automatically in full backup bundles.

The script prints per-table source vs. target row counts; migration is only
considered successful when they match.

## Privacy invariants (unchanged from Infovore)

- **Search queries are stored only as AES-256-GCM ciphertext**
  (`query_ciphertext`), encrypted server-side with `YOUTUBE_PRIVATE_DATA_KEY`
  before touching the database. No API or page ever returns them.
- **Watch progress / resume positions** (`youtube_video_progress`) feed only
  aggregate stats (content covered, progress coverage); raw rows are never
  served.
- YouTube `activities` rows are `visibility='summary'`: excluded from any
  public timeline/query surface (`queryActivities` filters `public` only).
- `/api/youtube/recent.json` strips `watchedAt` and `actualWatchedSeconds`.
- AI classification sends **only public video metadata** (title, channel,
  description, tags) — never timestamps, watch counts, searches, or progress.
- Cross-user topic vectors use one source-controlled taxonomy version and the
  dedicated `youtube_video_matching_topics` table. Personalized topic slugs
  never enter matching; sensitive YouTube categories are stored only as an
  excluded classification with no public topic key.

## Secrets

| Secret | Handling |
|---|---|
| `YOUTUBE_PRIVATE_DATA_KEY` | **Must be identical to Infovore production's value**, otherwise migrated search ciphertext and the OAuth refresh token become undecryptable. The operator copies it by hand at cutover (Step in runbook). It is never read by tooling, never committed, never logged. |
| `INGEST_TOKEN` | New value, generated fresh for urtube (≥32 chars). |
| `YOUTUBE_CAPTURE_TOKEN` | New value, generated fresh; entered into the Chrome extension options. |
| `YOUTUBE_API_KEY`, `AI_*`, Google OAuth client | May be reused or re-issued; operator's choice. Reusing the Google Data Portability OAuth client requires adding `https://urtube.observe.tw/api/ingest/youtube/oauth/callback` as an authorized redirect URI. |

Rules enforced by this repo: `.env*`, `*.sqlite*`, and `data/` are
gitignored; no default in `src/config.ts` contains a real credential; nothing
under `/home/deck/Projects/infovore` is read for secrets or copied as data.

## Network boundary on SkyLabMac

Containers bind to localhost only — `127.0.0.1:18080` (app) and
`127.0.0.1:18081` (ingest). Caddy terminates TLS for `urtube.observe.tw` and
routes `/api/ingest/*` to 18081, everything else to 18080. Data lives in the
dedicated docker volume `urtube-data` (never Infovore's `infovore-data`).
