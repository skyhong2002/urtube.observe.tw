# Production CD

Merge to `main` → GitHub Actions `Check` → GHCR → Komodo `urtube-production`.
CI publishes application and numeric-compute images with the source SHA, then
atomically commits both digests to `codex/production-images`. This generated
branch is an output of main, not a development branch. Do not edit it manually.
An obsolete CI run cannot publish after main has advanced.

Komodo's native `Deploy urtube main` Procedure runs `DeployStackIfChanged` every
minute. An unchanged release does nothing. Deployments use `--no-build
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
The tunnel keeps its existing digest. The release manifest sets
`TUNNEL_TRANSPORT_PROTOCOL=http2`, so the transport change also runs through CD.
This was approved on 2026-09-22 as a mitigation for intermittent public probe
timeouts while local readiness remained healthy. QUIC being the sole cause is
not established; compare public and local probes after deployment. Credentials,
ingress routes, monitoring deadlines, and application behavior are unchanged.
To roll back this transport choice, revert the manifest override on main and
let CD restore the host-owned default (`auto`, currently QUIC).

On 2026-09-23, the user approved a follow-up `TUNNEL_REGION=us` trial because
HTTP/2 alone did not resolve the timeouts. External probes reached Cloudflare's
edge successfully in 20/20 attempts, while 4/20 requests forwarded to URtube
exceeded 12 seconds; local probes stayed healthy. US-only tunnel connections
test an alternative forwarding path and may add latency. Keep HTTP/2 and compare
local and external probes after CD. If timeouts persist, remove only
`TUNNEL_REGION` from the release manifest and its test, then let CD roll back
the region override. This does not change the public hostname or origin routes.

CI updates images and the approved `MATCHING_V3_BACKFILL_VIDEO_LIMIT` from
`matching-rollout.json`. This environment override is applied to every
application service in the same atomic release, taking precedence over private
env files. Since 2026-09-23, `release.py` also sets `AI_MODEL=gpt-6-sol` and
`MATCHING_V3_CLASSIFICATION_MODEL=gpt-6-luna` on all application services.
`AI_REUSE_MODEL=gpt-5.6-sol` and
`MATCHING_V3_CLASSIFICATION_CACHE_MODEL=gpt-5.6-luna` preserve completed work;
these are compatibility identifiers, never outgoing request models. Keep the
existing host-owned endpoint cache namespace. See [model migration](../../docs/ai-gateway.md).
Apart from these model/reuse and tunnel transport/region overrides, other service,
volume, port or environment changes require an explicit
update to the host-owned configuration; changing repository Compose files alone
does not apply them. Never run the old `urtube-deploy` or
source-build Compose command alongside Komodo.

## Backup, checks and cleanup

Before each changed release, Komodo invokes the existing authorized helper:
`sudo -n -u deck /home/deck/urtube-ops/snapshot.sh pre-komodo`.
A failed snapshot aborts deployment. Snapshots remain under
`/home/shared/urtube/snapshots/`; this CD does not delete them.
After Compose succeeds, both public `/healthz` and `/readyz` must pass.
Then prune all unused application images after each successful deployment, restricted by the
OCI source label `https://github.com/skyhong2002/urtube.observe.tw`, and build
cache unused for seven days with a 2 GB reserve. Active images and volumes are
never pruned. Old unused images are not retained locally; rollback requires a
registry pull. Build-cache pruning is
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


## Matching rollout stages

The current approved stage is 5,000 latest distinct videos per account. Change
`matching-rollout.json` through main and the normal Check/publish/CD workflow.
There is no timer or automatic promotion to a larger stage. Keep provider budgets,
concurrency and cache namespaces unchanged. Observe the new-version job states,
completed items per minute, 429/5xx and backoff before proposing the next stage.
The source-window change creates a new profile version but reuses successful
video, embedding and channel caches. Older profiles remain stored until replaced.
