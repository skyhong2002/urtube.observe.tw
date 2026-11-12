# Production CD on the Dokploy stack

Production runs as the Dokploy compose project `urtube-yeccgu` on the
production host. CI still publishes images and writes their digests to
`deploy/komodo/images.json` on the `codex/production-images` branch (see
`deploy/komodo/README.md`); Komodo no longer deploys them. Instead a small
agent on the host, `sync.py`, runs from a systemd timer every two minutes:

1. `git ls-remote` reads the branch head; nothing happens if that manifest
   commit is already deployed (`/var/lib/urtube-cd/state.json`).
2. It downloads `images.json` pinned to that commit.
3. It refuses to deploy if any manifest environment value differs from the
   stack's env files (it reports key names only). CD never changes
   configuration; change env files deliberately, then let CD continue.
4. It backs up `docker-compose.yml` as `docker-compose.yml.cd-backup-<UTC>`
   (keeping the last ten), pulls the new images, rewrites only the `image:`
   lines of changed services and recreates only those services with
   `docker compose up -d --no-deps --no-build --wait`.
5. It checks each changed container runs the new image and is healthy and that
   `https://urtube.observe.tw/healthz` answers 200. On any failure it restores
   the backup and recreates the same services on their previous images, then
   records `rolled-back` in the state file.

It never builds, never touches volumes, env files, Traefik labels or other
stacks, accepts only `ghcr.io/skyhong2002/...@sha256:` images, and skips a
cycle while the host load average exceeds 20.

## Install or update on the host

```sh
sudo install -D -m 0755 deploy/dokploy/sync.py /usr/local/lib/urtube-cd/sync.py
sudo install -m 0644 deploy/dokploy/urtube-cd.service deploy/dokploy/urtube-cd.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now urtube-cd.timer
```

The installed copy does not update itself from the repository; reinstall after
changing `sync.py`.

## Operate

```sh
sudo python3 /usr/local/lib/urtube-cd/sync.py --dry-run --force  # show the plan
journalctl -u urtube-cd.service -n 50                             # recent runs
sudo cat /var/lib/urtube-cd/state.json                            # last result
sudo systemctl disable --now urtube-cd.timer                      # pause CD
```

To roll back by hand, copy the wanted `docker-compose.yml.cd-backup-*` over
`docker-compose.yml` and run the same `docker compose up -d --no-deps --no-build
--wait <services>`; pause the timer first or it will redeploy the manifest.

Dokploy keeps its own stored copy of the compose file. Redeploying the stack
from the Dokploy UI can restore older images; CD will move them forward again
on its next cycle.
