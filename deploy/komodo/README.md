# Production CD

Merge to `main` → GitHub Actions `Check` → GHCR → Komodo `urtube-production`.
CI publishes application and numeric-compute images with the source SHA, then
atomically commits both digests to `codex/production-images`. This generated
branch is an output of main, not a development branch. Do not edit it manually.
An obsolete CI run cannot publish after main has advanced.

Komodo's native `Deploy urtube main` Procedure runs `DeployStackIfChanged` every
five minutes. An unchanged release does nothing. Deployments use `--no-build
--wait --wait-timeout 180`; the host does not compile application code.

## Operator access

```sh
ssh -p 2222 -N -L 127.0.0.1:19120:127.0.0.1:9120 urtube@100.78.116.118
```

Open http://localhost:19120. Login credentials are in the host's private
`~/komodo/.env` (`KOMODO_INIT_ADMIN_USERNAME`, `KOMODO_INIT_ADMIN_PASSWORD`).
Do not commit credentials. Core is loopback-only; Periphery connects outbound
and runs as the `urtube` user, with systemd lingering enabled.

## Production configuration

Stack project name is `urtube`; file paths are:

1. `/home/urtube/komodo/production.compose.json` (host-owned effective settings)
2. `deploy/komodo/images.json` (generated, immutable image override)

Private per-service env files use Compose `format: raw`. The native config
command wrapper is `[[COMPOSE_COMMAND]] --no-env-resolution`, included for
`config` only, so deployment logs do not expand secrets. Keep this setting.
The shared database volume remains `urtube_urtube-data`. Environment values,
ports, mounts and commands were compared with the previous effective config.
The tunnel keeps its existing digest.

CI updates images only. A service, volume, port or environment change requires
an explicit update to the host-owned configuration; changing repository Compose
files alone does not apply such changes. Never run the old `urtube-deploy` or
source-build Compose command alongside Komodo.

## Backup, checks and cleanup

Before each changed release, Komodo invokes the existing authorized helper:
`sudo -n -u deck /home/deck/urtube-ops/snapshot.sh pre-komodo`.
A failed snapshot aborts deployment. Snapshots remain under
`/home/shared/urtube/snapshots/`; this CD does not delete them.
After Compose succeeds, both public `/healthz` and `/readyz` must pass.
Then prune unused application images older than seven days, restricted by the
OCI source label `https://github.com/skyhong2002/urtube.observe.tw`, and build
cache unused for seven days with a 2 GB reserve. Active images and volumes are
never pruned. Recent images are retained for rollback. Build-cache pruning is
daemon-wide and may slow future builds by other projects.

Docker data is on `/home/.docker-data`, a separate loop filesystem: image cleanup
does not necessarily free `/home`, where snapshots live. Check both filesystems.

## Failure and rollback

Inspect the failed Stack/Procedure update in Komodo. Disable the Procedure
schedule before manual recovery. A Compose timeout may leave some services
updated; verify each running image and public health before declaring success.
There is no automatic database rollback. If an application rollback is safe,
revert the code on main and let CI publish a new verified release. Do not
restore a database merely because an image deployment failed.

Use `urtube-snapshot` for manual data backups. `docker ps` / `docker logs` remain
available. Back up Komodo's MongoDB, named keys volume and private `~/komodo`
configuration separately when maintaining the host; database snapshots of the
application do not include Komodo management state.
