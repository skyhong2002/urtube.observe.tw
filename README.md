# urtube

A self-hosted, multi-user YouTube attention archive, extracted from
[Infovore]'s YouTube subsystem. Tracks watch history (Google My
Activity, YouTube History), measured viewing time (Chrome extension), saved
progress, metadata, and AI topics — privately, per user.

- Public URL: https://urtube.observe.tw
- Docs: [MIGRATION_PLAN.md](MIGRATION_PLAN.md) ·
  [YOUTUBE_BOUNDARY.md](YOUTUBE_BOUNDARY.md) ·
  [CUTOVER_RUNBOOK.md](CUTOVER_RUNBOOK.md)

## Privacy model

Search queries are AES-256-GCM-encrypted server-side before storage and never
served. Watch progress feeds aggregates only. Dashboards are private per user
(token link) unless made public. AI classification sees public video metadata
only. Cross-user matching never compares the personalized AI topic slugs:
it uses the source-controlled, versioned taxonomy in
`src/youtube/matching.ts`, derived from YouTube's public category ID. News &
Politics and Nonprofits & Activism are excluded from matching by default.
Matching classifications are stored by taxonomy version without deleting the
previous version. After a version bump the worker rebuilds them in the
background; until both profiles reach 80% current-version coverage, topic
comparison is disabled and the product falls back to aggregate channels.
The shared registry stores only an internal, versioned 90-day matching
projection: data-volume/coverage counters plus capped topic and channel
shares. Raw events, video lists, keywords, searches, and playback timestamps
remain in each user's SQLite file. The Insights keyword cloud is built from
public title/tag/description metadata by the versioned pipeline described in
`docs/keyword-pipeline.md`; keywords never enter matching. Imports enqueue a projection refresh, and
the worker atomically publishes it without dropping a newer queued refresh.
Both channel and canonical-topic comparisons use that 90-day window, so old
history cannot dominate a current match. Pool eligibility is controlled by
the constants in `src/youtube/matching.ts` (initially 200 recent watch events
across 14 active days); incomplete topic coverage falls back to channels.
User-facing comparisons show qualitative bands and a sync/processing next
step instead of exposing exact scores or the activity cutoff.
Matching is off by default and independent of `dashboard_public`. After data
setup, guided onboarding and the account page suggest up to five leading
canonical interests from the eligible 90-day projection. A signed-in user can
choose the interests to match on and separately exclude interests that must never reach matching,
recommendations, or icebreakers. Choices store stable keys plus the taxonomy
version; a version change disables topic matching until explicit
reconfirmation. If no mutually usable topic remains, matching falls back to
aggregate channels when possible. Disclosure is a separate presentation-only
setting: candidate cards show at most two broad shared topics, plus one common
channel only when both people allow it. Turning matching off removes the user
from new candidate queries immediately; it does not change or publish the
personal dashboard.
`/matches` is session-only and requires that opt-in. It ranks at most 250
eligible profiles using equal internal topic/channel weight and renders five
cards per finite batch. Cards contain only a display name, qualitative band,
up to two allowed canonical topics, an optional mutually allowed channel, and
a generic icebreaker; the service-to-template model omits exact scores and
never exposes handles, crystals, histories, shares, or candidate dashboards.
When at least three of the ten nearest eligible people contribute the same
unseen item, `/matches` may also show up to five broad topics and five channels
as a group signal. It never names contributors or exposes their values, videos,
or source details. Channels from people who allow topic-only disclosure are not
used. Governed news, editorial, and political channels are excluded. If those
labels cannot be verified, channel recommendations stay hidden.
“Want to meet” uses a short-lived opaque action token, so candidate handles and
internal ids never enter the page. A request reveals nothing new. The recipient
can accept, skip locally, or decline, and the sender can withdraw while it is
pending. A decline hides that pair; either person can disconnect after acceptance.
Only acceptance creates a connection. Every connection read checks the
accepted request and both users' current matching opt-in before returning the
introduction and contact method each person chose to share. Current topic
exclusions are reapplied to saved icebreakers. Turning matching off withdraws
pending requests and established connections immediately.

## Run

```sh
cp .env.example .env   # fill in tokens
npm ci
npm run check          # typecheck + tests
npm start              # dashboard on :3000
npm run ingest         # ingest API (separate process, same DB)
npm run worker         # hourly metadata/topics/portability worker
```

Production: `docker compose up -d --build` starts app, ingest, worker, and
daily multi-user backup services (binds 127.0.0.1:18080/18081; front with
Caddy — see CUTOVER_RUNBOOK.md). Probe `/healthz` for liveness and `/readyz`
for worker/backup/config/all-user readiness.

## Users

Signup is gated behind **Sign in with Google** (`/signup` → OAuth → pick a
handle): one Google account maps to exactly one archive, keyed on Google's
permanent `sub` claim (never the email, which can change). Accounts created
before Google sign-in can be claimed from the same form with their dashboard
key. New dashboards stay private. `/onboarding` then resumes from stored state
and guides desktop Extension setup, the first scan, processing, private insight
preview, interest confirmation, and the matching choice. It never asks the
person to copy a token. Reaching the matching data threshold unlocks the next
step even while background processing continues, with provisional results
marked clearly.
Only the final decision records `onboarding_completed_at`. Earlier steps are
derived from scan rows, processing counts, the current matching crystal, and
confirmed interest settings, so refresh and sign-in cannot drift into a second
onboarding state machine.

Sessions live in an HttpOnly cookie for 180 days. `/account` shows your
dashboard link and lets you rename yourself, configure matching privacy,
choose what introduction and contact method a mutual match may see, choose or
exclude matching interests, toggle dashboard visibility, rotate
tokens (lost-token recovery), and sign out. Signups
are rate-limited per IP; disable them with `SIGNUP_ENABLED=false` (login and
claiming stay available).

Google OAuth env: `GOOGLE_LOGIN_CLIENT_ID` / `GOOGLE_LOGIN_CLIENT_SECRET`
(fall back to the `GOOGLE_DATA_PORTABILITY_*` pair); the redirect URI is
`<PUBLIC_BASE_URL>/auth/google/callback`.

Admin equivalents:

```sh
npm run user:create -- dad "Dad"        # prints capture + dashboard tokens once
npm run user:create -- dad --rotate     # rotate tokens
npm run user:create -- dad --delete     # remove the user and their database
```

Each user's dashboard is at **`/<handle>`** (`/u/<handle>` redirects; private
dashboards append `?key=<dashboardToken>` for keyless browsers) and their
data is its own SQLite file under `data/users/`, with a per-user derived
search encryption key.

## Data import

Per-user: POST a historical archive ZIP to `/api/ingest/youtube/takeout`
with your capture token (kept for old Takeout exports). Localized Takeout
folder names are accepted, and HTML timestamps support English, Chinese,
Japanese, and Korean formats. If a recognized history file uses another time
format, the error reports how many records were found and skipped. Owner CLI:

```sh
npm run youtube:import -- /path/to/takeout.zip     # owner CLI import
npm run db:backup -- /path/to/backup-bundle       # all users, hashes + manifest
npm run db:restore -- /path/to/bundle /path/to/data  # while services are stopped
npm run db:migrate-from-infovore -- <backup> <target>  # YouTube-only migration
```

The extension's **Sync now** action skips only a continuous history range
whose oldest boundary was verified. A stalled or time-limited scan is saved
for diagnosis but never treated as complete; **Rescan all history** always
ignores saved coverage. Deep rescans use bounded 90-day Google My Activity
date windows and restart the scan tab between windows; a window that reaches
2,000 rows is split automatically. Closing the tab preserves the remaining
windows so the next rescan resumes safely. Re-running either path is
idempotent. YouTube's history page progress scan has the same 2,000-row tab
limit, while the bounded My Activity pass supplies the complete event archive.
