# CUTOVER_RUNBOOK — urtube.observe.tw

Operational procedures: health, backup, restore, migration, rollback, and
disabling old Infovore YouTube ingestion. Commands assume:

- Production: `ssh SkyLabMac`, checkout `/Users/skyhong/Projects/urtube`,
  Docker via colima, Caddy config `/usr/local/etc/caddy/Caddyfile`.
- Old data: `ssh skyhong.tw`, Infovore compose stack at
  `/home/ubuntu/apps/status.skyhong.tw`, volume `infovore-data`.
- **Never** run migration steps while coding; Phase 3 is a deliberate,
  operator-triggered window.
- The current stack is multi-user: `users.sqlite`, owner `urtube.sqlite`, and
  every database under `users/` must always be backed up and restored together.

## 0. Caddy / TLS (must succeed before anything else)

```sh
ssh SkyLabMac 'sudo cp /usr/local/etc/caddy/Caddyfile /usr/local/etc/caddy/Caddyfile.bak-$(date +%Y%m%d%H%M%S)'
```

Add to the Caddyfile:

```caddy
urtube.observe.tw {
    encode zstd gzip

    @ingest path /api/ingest/*
    handle @ingest {
        reverse_proxy 127.0.0.1:18081
    }

    handle {
        reverse_proxy 127.0.0.1:18080
    }
}
```

Reload and verify TLS (adjust the reload command to how Caddy runs on the
Mac — brew service or manual):

```sh
ssh SkyLabMac 'caddy validate --config /usr/local/etc/caddy/Caddyfile && caddy reload --config /usr/local/etc/caddy/Caddyfile'
curl -svo /dev/null https://urtube.observe.tw/ 2>&1 | grep -E 'subject:|SSL certificate verify'
```

Rollback: restore the `.bak-*` file and reload.

## 1. Deploy / upgrade the parallel service

```sh
ssh SkyLabMac
cd /Users/skyhong/Projects/urtube   # first time: git clone git@github.com:skyhong2002/urtube.observe.tw.git urtube
cp .env.example .env                # first time only — then fill in:
#   PUBLIC_BASE_URL=https://urtube.observe.tw
#   INGEST_TOKEN=$(openssl rand -base64 48 | tr -d '\n')
#   YOUTUBE_CAPTURE_TOKEN=$(openssl rand -base64 48 | tr -d '\n')
#   YOUTUBE_PRIVATE_DATA_KEY=<placeholder now; REAL Infovore value at step 4>
git pull --ff-only
docker compose up -d --build
```

## 2. Health

```sh
curl -fsS https://urtube.observe.tw/healthz            # app: healthy even when empty
curl -fsS https://urtube.observe.tw/api/ingest/youtube/capture/status \
  -H "authorization: Bearer $YOUTUBE_CAPTURE_TOKEN"    # {"status":"ready",...}
curl -is https://urtube.observe.tw/api/ingest/youtube/capture -X POST \
  -H 'content-type: application/json' -d '{}' | head -1  # HTTP/2 401 (no token)
curl -fsS https://urtube.observe.tw/status | jq .youtube.counts
curl -fsS https://urtube.observe.tw/readyz              # config + all DBs + worker + backup
docker compose ps                                      # all four containers Up
```

During a long catch-up cycle, readiness uses the worker's 30-second heartbeat
instead of waiting hours for every archive to finish. A stopped/failed worker
or a heartbeat older than two minutes still makes `/readyz` return 503; an
idle worker must have a successful completion from the last three hours.

## 3. Backup

**urtube (automatic):** configure the host bind mount in `.env`. Keep this
directory on storage that is also copied off-host:

```sh
URTUBE_BACKUP_HOST_DIRECTORY=/Users/skyhong/backups/urtube
BACKUP_INTERVAL_HOURS=24
BACKUP_RETENTION_DAYS=30
docker compose up -d backup
curl -fsS https://urtube.observe.tw/readyz | jq .backup
```

The backup service snapshots registry, owner, and every materialized user DB
with SQLite `VACUUM INTO`. Each bundle contains integrity-checked row counts
and SHA-256 hashes. `YOUTUBE_PRIVATE_DATA_KEY` stays in a password manager;
only its fingerprint enters the bundle. Manual bundle:

```sh
docker compose exec backup npx tsx scripts/backup.ts /backups/urtube-manual-$(date +%Y%m%d%H%M%S)
```

**Infovore production (for migration):** run *on skyhong.tw*, inside its
container, never against a live file copy:

```sh
ssh skyhong.tw 'cd /home/ubuntu/apps/status.skyhong.tw && docker compose exec infovore \
  node -e "const {DatabaseSync}=require(\"node:sqlite\");const d=new DatabaseSync(\"/data/infovore.sqlite\",{readOnly:true});d.exec(\"VACUUM INTO \x27/data/infovore-backup.sqlite\x27\");d.close()"'
ssh skyhong.tw 'cd /home/ubuntu/apps/status.skyhong.tw && docker compose cp infovore:/data/infovore-backup.sqlite /tmp/infovore-backup.sqlite'
scp skyhong.tw:/tmp/infovore-backup.sqlite /tmp/infovore-backup.sqlite
scp /tmp/infovore-backup.sqlite SkyLabMac:/Users/skyhong/backups/infovore-backup.sqlite
```

Do **not** copy the whole `infovore-data` volume and do not use a locally
checked-out empty `infovore.sqlite` — only this vacuumed production snapshot.

## 4. Migration (Phase 3 — single write window)

1. Announce/stop new writes: pause the Chrome extension (toggle "Capture
   viewing sessions" off) so no events land on Infovore mid-window.
2. Take the Infovore backup (step 3) and place it on SkyLabMac.
3. Build the YouTube-only database and verify counts (the script prints
   source vs. target rows per table and exits non-zero on mismatch):

```sh
ssh SkyLabMac
cd /Users/skyhong/Projects/urtube
docker compose cp /Users/skyhong/backups/infovore-backup.sqlite app:/data/infovore-backup.sqlite
docker compose exec app npx tsx scripts/migrate-from-infovore.ts \
  /data/infovore-backup.sqlite /data/urtube-migrated.sqlite
```

4. Set the real `YOUTUBE_PRIVATE_DATA_KEY` in `.env` (hand-copy from the
   Infovore production host's env — do not commit, do not paste into logs).
   Without it, migrated search ciphertext and the Data Portability refresh
   token cannot be decrypted.
5. Swap the database in:

```sh
docker compose stop
docker compose run --rm app sh -c \
  'cp /data/urtube.sqlite /data/urtube-pre-migration.sqlite 2>/dev/null; mv /data/urtube-migrated.sqlite /data/urtube.sqlite && rm -f /data/urtube.sqlite-wal /data/urtube.sqlite-shm'
docker compose up -d
```

6. Verify: `curl -fsS https://urtube.observe.tw/status | jq .youtube.counts`
   must match the migration script's target counts; open
   `https://urtube.observe.tw/youtube` and spot-check history depth,
   channels, and topics.

## 5. Restore (from a complete urtube bundle)

```sh
ssh SkyLabMac
cd /Users/skyhong/Projects/urtube
docker compose stop app ingest worker backup
docker compose run --rm --no-deps backup npx tsx scripts/restore-backup.ts \
  /backups/<BUNDLE_DIRECTORY> /data
docker compose up -d
curl -fsS https://urtube.observe.tw/readyz
```

Restore verifies every file hash, SQLite integrity, and private-key
fingerprint before changing data. Existing databases are moved aside with a
`.pre-restore-*` suffix so the restore remains recoverable.

## 6. Chrome extension cutover

1. Install/update **urtube YouTube Capture** from the Chrome Web Store. Use
   `extension.zip` unpacked only as a development fallback.
2. Options → endpoint `https://urtube.observe.tw/api/ingest/youtube/capture`,
   token = urtube's `YOUTUBE_CAPTURE_TOKEN` → *Test connection* must say
   "Connection ready."
3. Real capture test: watch any video ≥ 30 s, then confirm the popup shows a
   sent capture and `https://urtube.observe.tw/youtube` shows measured
   seconds for it.
4. Run "Sync now" once and confirm history/progress land (popup: events +
   progress rows; `/status` counts increase).

## 7. Disable old Infovore YouTube ingestion

Only after step 6 succeeds. On skyhong.tw, edit the Infovore `.env`:

- Set `SOURCES` to the non-YouTube list
  (`SOURCES=backloggd,kitsu,statsfm,simkl,goodreads`).
- Unset/blank `YOUTUBE_CAPTURE_TOKEN` (its capture/history/progress
  endpoints then answer 503, so any stale client fails loudly instead of
  silently forking history).
- Stop the YouTube worker: `docker compose stop infovore-youtube-worker` and
  remove the service from its compose file on the next deploy.

Then `docker compose up -d` and verify Infovore's other platforms still
serve, and `https://infovore.skyhong.tw/api/ingest/youtube/capture` returns
503.

## 8. Rollback

- **Before step 7**: nothing to undo — Infovore was never touched. Stop the
  urtube stack (`docker compose down`) and optionally remove the Caddy block.
- **After step 7**: restore Infovore's `.env` (re-add youtube to `SOURCES`,
  restore `YOUTUBE_CAPTURE_TOKEN`), `docker compose up -d` on skyhong.tw,
  and point the extension back at
  `https://infovore.skyhong.tw/api/ingest/youtube/capture` with the old
  token. Events captured only by urtube in the interim can be replayed later
  via a Takeout import on either side (idempotent), so no data is lost.
- **Bad urtube deploy**: `git checkout <last-good> && docker compose up -d
  --build`; database untouched. **Bad migration**: step 5 restore of
  `urtube-pre-migration.sqlite` or any earlier backup.

## Invariants (always true)

- Production Infovore data is only ever read via the vacuumed backup file.
- urtube containers publish on 127.0.0.1 only; TLS is Caddy's job.
- No secrets in git; `YOUTUBE_PRIVATE_DATA_KEY` moves by hand exactly once.
- Every urtube backup/restore covers registry, owner, and all user databases;
  every restore ends with hash, integrity, key-fingerprint, and `/readyz`
  verification before the service is considered up.
