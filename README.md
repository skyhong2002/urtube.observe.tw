# urtube

A self-hosted, multi-user YouTube attention archive, extracted from
[Infovore]'s YouTube subsystem. Tracks watch history (Takeout, Google My
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
only.

## Run

```sh
cp .env.example .env   # fill in tokens
npm ci
npm run check          # typecheck + tests
npm start              # dashboard on :3000
npm run ingest         # ingest API (separate process, same DB)
npm run worker         # hourly metadata/topics/portability worker
```

Production: `docker compose up -d --build` (binds 127.0.0.1:18080/18081;
front with Caddy — see CUTOVER_RUNBOOK.md).

## Users

Signup is gated behind **Sign in with Google** (`/signup` → OAuth → pick a
handle): one Google account maps to exactly one archive, keyed on Google's
permanent `sub` claim (never the email, which can change). Accounts created
before Google sign-in can be claimed from the same form with their dashboard
key. Sessions live in an HttpOnly cookie for 180 days; `/account` shows your
dashboard link and lets you rename yourself, toggle visibility, upload a
Google Takeout, rotate tokens (lost-token recovery), and sign out. Signups
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

Per-user: upload a Takeout ZIP from `/account`, or POST it to
`/api/ingest/youtube/takeout` with your capture token. Owner CLI:

```sh
npm run youtube:import -- /path/to/takeout.zip     # owner CLI import
npm run db:backup                                  # consistent online backup
npm run db:migrate-from-infovore -- <backup> <target>  # YouTube-only migration
```
