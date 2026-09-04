# MIGRATION_PLAN — Infovore YouTube → urtube

Goal: extract every current Infovore YouTube tracking capability into this
standalone private service at `https://urtube.observe.tw`, run it in parallel
with production Infovore, then cut over without losing data or privacy
guarantees. See YOUTUBE_BOUNDARY.md for the exact code/data/secret boundary
and CUTOVER_RUNBOOK.md for the operational steps.

## Capabilities extracted

1. **Takeout import** — ZIP upload (`POST /api/ingest/youtube/takeout`) and
   CLI (`npm run youtube:import -- takeout.zip`); JSON + HTML history
   parsers, cross-format second-precision dedupe.
2. **My Activity sync** — Chrome extension scrapes
   `myactivity.google.com/product/youtube` daily and posts normalized
   watch/search batches to `/api/ingest/youtube/history` (checkpointed via
   `/history/status`, 2 h overlap window).
3. **YouTube History / progress import** — extension scrolls
   `youtube.com/feed/history`, extracts per-video progress bars and resume
   positions, posts batches to `/api/ingest/youtube/progress`.
4. **Chrome measured playback capture** — content script measures real
   watched seconds on youtube.com and posts sessions to
   `/api/ingest/youtube/capture` (cumulative, monotonic per session).
5. **Google Data Portability sync** — OAuth flow + daily archive job with
   checkpoint and 1-day overlap (`src/youtube/portability.ts`).
6. **Metadata enrichment** — YouTube Data API v3 videos + channels, batched
   by 50, unavailable-video tombstones.
7. **Topic classification** — personalized AI topics for private insights,
   plus a source-controlled 14-topic matching taxonomy derived from public
   YouTube category IDs; keyword extraction.
8. **Idempotent SQLite storage** — Infovore-compatible base migrations plus
   additive urtube migrations (`user_version` 1–10, `node:sqlite`, WAL).
9. **Private ingest APIs** — bearer-token endpoints, timing-safe comparison,
   size limits, strict zod validation.
10. **YouTube dashboard** — `/youtube` HTML dashboard (ranges 7d/28d/90d/all,
    channels, topics, keywords, daily volume, recent), plus
    `/api/youtube/summary.json` and `/api/youtube/recent.json`.
11. **Scheduled worker** — catch-up loop: portability step → video metadata →
    channel metadata → canonical matching classification → private AI topics.

Not extracted: satori/resvg SVG cards, MCP server, other platform sources,
generic `/api/ingest/events` (all remain Infovore features).

## Deltas vs. Infovore (intentional)

- `PUBLIC_BASE_URL` is configurable; nothing hardcodes `infovore.skyhong.tw`.
  Default OAuth redirect derives from it.
- Dashboard path is `/youtube` (extension + OAuth redirect updated to match).
- App `/healthz` reports healthy whenever the database is reachable and
  required config is present — an **empty** database is healthy (required so
  the parallel deployment can pass health checks before any data migration).
  Counts are included for observability. Ingest `/healthz` unchanged.
- Docker: image/containers `urtube`, `urtube-app`, `urtube-ingest`,
  `urtube-worker`; volume `urtube-data`; ports published on
  `127.0.0.1:18080` / `127.0.0.1:18081` only (Caddy fronts them).
- Extension renamed (`urtube YouTube Capture`), endpoint validation pinned to
  `https://urtube.observe.tw/api/ingest/youtube/capture`.

## Phases

### Phase 0 — hosting precondition (SkyLabMac)
Caddy currently has no `urtube.observe.tw` site block; HTTPS answers with a
TLS internal error. Before any cutover work:
1. Back up `/usr/local/etc/caddy/Caddyfile`.
2. Add the site block (encode zstd/gzip; `/api/ingest/*` →
   `127.0.0.1:18081`; default → `127.0.0.1:18080`) and reload Caddy.
3. Certificate issuance needs the backend for nothing — verify TLS handshake
   succeeds; `/healthz` will 502 until the app is deployed, then must return
   healthy over HTTPS before anything else proceeds.

### Phase 1 — build (this repo, no production contact)
- Extract code per YOUTUBE_BOUNDARY.md; write tests (unauthorized ingest,
  capture idempotency, history checkpoint overlap, progress idempotency,
  Takeout import, privacy boundaries, migration row-count verification).
- `npm run check` (typecheck + tests) and `docker build` must pass.
- Publish to `github.com/skyhong2002/urtube.observe.tw` (private).

### Phase 2 — parallel deployment (SkyLabMac, empty database)
- Clone to `/Users/skyhong/Projects/urtube`, create `.env` with **freshly
  generated** `INGEST_TOKEN` / `YOUTUBE_CAPTURE_TOKEN` / placeholder
  `YOUTUBE_PRIVATE_DATA_KEY` (replaced by the real one at cutover),
  `PUBLIC_BASE_URL=https://urtube.observe.tw`.
- `docker compose up -d --build` (colima context); verify
  `https://urtube.observe.tw/healthz` and ingest auth (401 without token).
- Local smoke tests: unauthorized POST rejected; sample capture accepted and
  visible on `/youtube`.
- Load the extension unpacked, point it at urtube with the new capture
  token, run a real capture test (watch ≥ 30 s, confirm the event appears).
  Wipe smoke-test data afterwards (`docker volume` reset) or accept it —
  cutover restore replaces the database anyway.

### Phase 3 — data migration (single write window)
- Backup on skyhong.tw (`VACUUM INTO` inside the Infovore container), copy to
  SkyLabMac, run `scripts/migrate-from-infovore.ts` → YouTube-only urtube
  database, verify row counts, swap into `urtube-data`, restart, re-verify
  counts via `/status`. Full commands in CUTOVER_RUNBOOK.md.
- Set the real `YOUTUBE_PRIVATE_DATA_KEY` (hand-copied by operator).

### Phase 4 — cutover & disable old ingestion
- Repoint the Chrome extension endpoint/token at urtube.
- Disable Infovore's YouTube ingestion (unset its capture/ingest YouTube
  config or stop its worker; details in runbook) — Infovore keeps serving its
  other platforms.
- Watch both sides for a few days; rollback path stays available.

### Definition of "migration complete"
All of: parallel service healthy over HTTPS at `urtube.observe.tw` · Infovore
production DB backed up **and** restored into urtube with matching row
counts · Chrome extension passes a real capture test against production
urtube · old Infovore YouTube ingestion disabled or redirected. Until then,
this migration is *in progress*.

## Current multi-user architecture

The earlier single-user roadmap has been implemented. Google login maps one
permanent Google `sub` to one urtube account; tokens are hashed; each non-owner
account has an isolated SQLite file and a key derived from the server master
key; dashboards are private by default; the Web Store extension provisions a
capture token in one click. Self-service rename, visibility, token rotation,
and deletion are live.

Launch safeguards include total-account capacity, per-user database and
ingest-rate limits, aggregate-only public dashboards, all-tenant checksummed
backup/restore bundles, a daily backup service, and `/readyz` coverage for
configuration, every user database, worker completion, and backup freshness.

Remaining post-launch product work: self-service data export before deletion,
and finer per-user/day accounting for pooled YouTube API and AI costs.
