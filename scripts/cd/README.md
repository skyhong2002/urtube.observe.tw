# urtube CD

A user systemd timer checks the current `main` commit against the latest `Check`
push run every five minutes. Only a completed successful run for that exact SHA
can invoke `sudo -n -u deck /home/deck/urtube-ops/deploy.sh <sha>`.
No GitHub token, inbound webhook, self-hosted Actions runner, or new dependency
is needed for this public repository.

## Installation prerequisites

Read the host-owned deploy/up scripts first. Verify that `deploy.sh <sha>` fetches
and deploys the supplied immutable commit and retains all production overlays,
volume names, secrets and service settings. Verify the current running revision;
do not initialize state from main without proving that revision is deployed.
The current source checkout and production overlays differ from the historical
CUTOVER_RUNBOOK examples. Never substitute those old commands.

Copy the Python file to `~/.local/lib/urtube-cd/` and the two unit files to
`~/.config/systemd/user/`. Run `loginctl enable-linger urtube` so it survives logout.

Validate without deploying:

```sh
python3 scripts/cd/test_cd.py
python3 ~/.local/lib/urtube-cd/urtube-cd.py
systemd-analyze --user verify ~/.config/systemd/user/urtube-cd.service ~/.config/systemd/user/urtube-cd.timer
```

Only after the prerequisites are verified, create
`~/.local/state/urtube-cd/state.json` containing
`{"deployed":"<verified currently deployed 40-character SHA>"}` and enable:

```sh
systemctl --user daemon-reload
systemctl --user enable --now urtube-cd.timer
systemctl --user start urtube-cd.service
journalctl --user -u urtube-cd.service -n 50 --no-pager
```

## Failure and recovery

The script records `attempted` before dispatch. Any deployment error, timeout,
interruption, or failed public health check leaves it set and blocks further
production changes until an operator investigates. Missing or malformed state
also prevents deployment. It never automatically restores databases, retries a
failed deployment, or assumes an image rollback is safe after a schema change.

After repairing or reverting through the host deployment procedure, verify the
running source revision and health, then replace state with that verified
`deployed` SHA (without `attempted`). Logs are in the user journal; no external
notification is configured. Pause with `systemctl --user stop urtube-cd.timer`.
Stopping the timer does not interrupt an already running deployment.

Public health confirms availability, not source identity. Deployment source
identity must be guaranteed by the reviewed host script and its evidence.
Changes to the CD agent itself require explicit installation; a new main commit
does not silently replace the deployment control program.
