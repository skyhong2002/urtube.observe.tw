# urtube

A self-hosted, multi-user YouTube attention archive, extracted from
[Infovore]'s YouTube subsystem. Tracks watch history (Google My
Activity, YouTube History), measured viewing time (Chrome extension), saved
progress, metadata, and AI topics — privately, per user.

- Public URL: https://urtube.observe.tw
- Docs: [MIGRATION_PLAN.md](MIGRATION_PLAN.md) ·
  [YOUTUBE_BOUNDARY.md](YOUTUBE_BOUNDARY.md) ·
  [CUTOVER_RUNBOOK.md](CUTOVER_RUNBOOK.md)

## Current product flow

The deployed flow is usable end to end: sign in with Google, provision the
Chrome extension or import an anonymous Takeout ZIP, follow persisted
processing states, inspect private insights, confirm matching interests, opt
in to matching, review bounded candidate cards, mutually consent to a
deeper comparison, then revoke that consent, export, or delete the archive. Empty,
insufficient-data, processing, failed, retry, and no-candidate states have
explicit UI instead of falling through to a misleading result.

```text
Chrome extension / Takeout / Data Portability
                    |
                    v
        authenticated ingest service
                    |
                    v
          isolated SQLite per user <---- scheduled metadata/topic worker
                    |                                |
                    |                  YouTube Data API + AI endpoint
                    v
           private dashboard app
                    |
          bounded 90-day projection
                    v
     shared registry -> opt-in matching -> mutual connection

     daily backup snapshots registry + every user database
```

## Privacy model

Search queries are AES-256-GCM-encrypted server-side before storage and never
served. Watch progress feeds aggregates only. Dashboards are private per user
(token link) unless made public. AI classification sees public video metadata
only. Personal topics use the governed, reviewable v2 pipeline in
`docs/personal-taxonomy-v2.md`. Existing v1 archives do not start a bulk AI
rebuild on deploy; their signed-in owner explicitly prepares a candidate at
`/account/taxonomy`, reviews its bounded evidence and quality, and then
activates it atomically. Cross-user matching never compares the
personalized AI topic slugs:
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

The topic trend on Insights follows the selected page range. Short ranges use
daily points, while yearly and all-time ranges use monthly points. Readers can
switch between raw and smoothed shares. Incomplete current-taxonomy
classification remains visibly provisional.

Both channel and canonical-topic comparisons use that 90-day window, so old
history cannot dominate a current match. Pool eligibility is controlled by
the constants in `src/youtube/matching.ts` (initially 200 recent watch events
across 14 active days); incomplete topic coverage falls back to channels.
User-facing matching results are whole percentages from 0–100. Formula version
`cosine-equal-v1` computes cosine similarity over the mutually allowed
canonical-topic vector and the aggregate channel vector, then gives each
available dimension equal weight. If only one dimension is available it is
used alone. Values are clamped and rounded to the nearest integer; raw shares,
vectors, event counts, and the activity cutoff never enter the presentation
model. A processing notice identifies provisional ordering.
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
eligible profiles using equal topic/channel weight and renders twenty people per
finite page. Cards contain only a display name, rounded match percentage, up
to two allowed canonical topics, an optional mutually allowed channel, and a
generic icebreaker. The avatar and card action open one split-screen VS
comparison, with the signed-in person on the left and the candidate on the
right, without first sending a request. The comparison uses a short-lived,
session-bound opaque token and adds bounded broad interest names plus rounded
topic/channel percentages; it never exposes
handles, emails, crystals, histories, raw shares, full vectors, introductions,
contacts, or candidate dashboards.
When at least three of the ten nearest eligible people contribute the same
unseen item, `/matches` may also show up to five broad topics and five channels
as a group signal. It never names contributors or exposes their values, videos,
or source details. Channels from people who allow topic-only disclosure are not
used. Governed news, editorial, and political channels are excluded. If those
labels cannot be verified, channel recommendations stay hidden.
“Want to meet” is a separate action on the VS page and uses its short-lived
opaque token, so candidate handles and internal ids never enter the page. The
same person remains in the directory while a request is pending or accepted.
The recipient can agree or decline, and the sender can withdraw while pending.
Only mutual consent unlocks additional broad comparison interests and the
mutually allowed channel clue; it does not reveal introductions or contact
details. Every comparison read checks the current relationship, topic
exclusions, data eligibility, and both users' opt-in. Either person can revoke
mutual consent, and turning matching off withdraws active relationships
immediately.

Signed-in users can export their own archive from `/account` after an explicit
confirmation. The response is a non-cacheable streamed ZIP containing readable
JSON, a schema and field manifest, decrypted owner search terms, metadata,
topics, aggregates, and sanitized matching records. Credentials, action tokens,
and other users' private profile or contact details are excluded.

Anonymous reference comparisons use a separate account opt-in. They compare
only the governed channel-category percentages described in
[`docs/reference-population.md`](docs/reference-population.md). Every person
has equal weight, and an axis stays hidden until at least five consenting
accounts have comparable data. The result shows rounded group statistics,
never identities, histories, matching data, or a claim about society.

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

The single **Sign up / sign in** entry uses Google (`/signup` → OAuth → pick a
handle for a new account): one Google account maps to exactly one archive, keyed on Google's
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

The primary menu is intentionally stable: signed-out pages show **Sign up /
sign in**, **Example dashboard**, and the language switch; signed-in pages show
**Dashboard**, **Matches**, **Account**, and the language switch. The urtube
brand always returns home.

Sessions live in an HttpOnly cookie for 180 days. `/account` shows your
dashboard link and lets you rename yourself, configure matching privacy,
choose or exclude matching interests, toggle dashboard visibility, rotate
tokens (lost-token recovery), and sign out. Signups
are rate-limited per IP; disable them with `SIGNUP_ENABLED=false` (login and
claiming stay available).

Google OAuth env: `GOOGLE_LOGIN_CLIENT_ID` / `GOOGLE_LOGIN_CLIENT_SECRET`
(fall back to the `GOOGLE_DATA_PORTABILITY_*` pair); the redirect URI is
`<PUBLIC_BASE_URL>/auth/google/callback`.

Profile pictures are served only through same-origin `/avatar/...` routes.
When Google's existing ID token includes an allowlisted `googleusercontent.com`
picture URL, the server uses it without adding the `profile` OAuth scope. If it
does not, the server tries Gravatar with the normalized email's SHA-256 hash,
then falls back to a local generated initial. Remote responses have a three
second timeout, a 1 MiB limit, and an image MIME allowlist; matching avatar
routes additionally require the current session and an opaque action/request
token. Browser HTML never receives an email hash or remote avatar URL.

Admin equivalents:

```sh
npm run user:create -- dad "Dad"        # prints capture + dashboard tokens once
npm run user:create -- dad --rotate     # rotate tokens
npm run user:create -- dad --delete     # remove the user and their database
```

Automatic app/ingest/worker bootstrap never prints owner credentials to
service logs. The legacy `YOUTUBE_CAPTURE_TOKEN` remains valid for the owner;
run the explicit `--rotate` command only when an operator needs new per-user
tokens, and capture its one-time output in a secure terminal.

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

## External services and source material

- Google OAuth provides account identity; Google My Activity, YouTube History,
  Takeout, and Data Portability provide user-authorized history. Data
  Portability is currently configured for the instance owner only.
- YouTube Data API v3 supplies public video/channel metadata. An
  OpenAI-compatible chat-completions endpoint classifies only that public
  metadata for the private, governed personal taxonomy.
- The matching taxonomy is not model-inferred: it is the source-controlled
  YouTube category mapping in `src/youtube/matching.ts`.
- News/editorial/political channel labels come from the versioned source and
  policy in `docs/channel-tag-policy.md`; unavailable or stale governance data
  fails closed.
- Runtime and build packages are pinned by `package-lock.json`. The project
  does not bundle third-party music, video, fonts, or participant watch data.

## Known limitations

- The bounded deep-history implementation has synthetic 50,000-event coverage,
  but the explicit five-year/50,000-event acceptance run on a signed-in 16 GB
  Mac is still awaiting an authorized Google test session (Issue #3).
- The packaged extension intentionally accepts only `urtube.observe.tw`; a
  different self-hosted origin requires rebuilding its host permissions and
  endpoint allowlist.
- Matching needs enough recent activity and consenting peers, so a valid
  result may still be “not enough data” or “no candidates.” External metadata,
  AI, and governance outages surface as retry/processing states or fail closed.

## License

urtube is licensed under the [MIT License](LICENSE). Third-party packages and
external data sources retain their respective licenses and terms.
