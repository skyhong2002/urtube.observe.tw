# Continuous deployment implementation plan

Goal: automatically deploy the current main commit only after its push Check workflow succeeds.

Architecture: a user systemd timer on skyhong-SM polls GitHub every five minutes using Python's standard library. It invokes the existing allowlisted `deploy.sh <sha>` and preserves host-owned Compose configuration and credentials. A separate deployment checkout must be confirmed from the host script before activation.

1. Implement the exact-SHA CI gate and synthetic checks for pending, failed, stale and PR runs.
2. Add a serialized deployment command, persistent success/failure state and bounded public health checks. Failed deployments require operator intervention; do not retry production mutations every timer tick.
3. Install a user service/timer and validate syntax and read-only CI inspection on the host.
4. Inspect host deploy/up scripts, verify source checkout and production revision, then enable and verify a real deployment. Keep the timer disabled if this prerequisite is unavailable.

No application behavior, user data, AI quotas, or classification caches are changed by these files. Deployment recreates services according to the existing host script, which must be inspected first.
