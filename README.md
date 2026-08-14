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

Anyone can self-onboard at **`/signup`**: pick a handle, get a capture token
and a private dashboard link (shown once, stored hashed), download the
pinned extension from `/extension.zip`, and start tracking. Signups are
rate-limited per IP; disable them entirely with `SIGNUP_ENABLED=false`.

Admin equivalents:

```sh
npm run user:create -- dad "Dad"        # prints capture + dashboard tokens once
npm run user:create -- dad --rotate     # rotate tokens (lost-token recovery)
npm run user:create -- dad --delete     # remove the user and their database
```

Each user gets a private dashboard at `/u/<handle>?key=<dashboardToken>` and
their own SQLite file under `data/users/`, with a per-user derived search
encryption key.

## Data import

```sh
npm run youtube:import -- /path/to/takeout.zip     # owner CLI import
npm run db:backup                                  # consistent online backup
npm run db:migrate-from-infovore -- <backup> <target>  # YouTube-only migration
```
