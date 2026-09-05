# AI classification gateway

Personal-taxonomy classification (`AI_CLASSIFICATION_ENABLED=true`) talks to an
OpenAI-compatible `/v1/chat/completions` endpoint at `AI_BASE_URL` with
`AI_API_KEY` as a bearer token. Production does not call a hosted model
directly; it uses a small shim that runs `codex exec` under the operator's
Codex CLI subscription.

## Layout on the production host

- Shim source: `~/bin/codex-openai-shim.mjs` (not in this repo). It accepts
  `SHIM_HOST`, `SHIM_PORT`, `SHIM_KEY`, and `CODEX_BIN`.
- Service: `systemctl --user status urtube-codex-shim` (unit in
  `~/.config/systemd/user/`, holds `SHIM_KEY`, mode 600; linger is enabled so
  it survives logout). Logs: `journalctl --user -u urtube-codex-shim`.
- Bind address: the `docker0` gateway (`172.17.0.1:8320`). Containers reach it
  as `host.docker.internal` through the `extra_hosts: host-gateway` entries on
  the `app` and `worker` services in `docker-compose.yml`, so `.env` keeps
  `AI_BASE_URL=http://host.docker.internal:8320/v1`.
- `AI_API_KEY` in `.env` must equal the unit's `SHIM_KEY`.
- The shim runs at most `SHIM_CONCURRENCY` (2) `codex exec` processes; the
  worker allows 4 in-flight requests, and one 20-video batch takes ~50 s, so
  `.env` sets `AI_TIMEOUT_MS=300000` to cover queueing.

## Checks

```sh
# from the host: 401 without the key, a completion with it
curl -s -X POST http://172.17.0.1:8320/v1/chat/completions -d '{}'
# from a container
docker exec urtube-worker node -e 'fetch("http://host.docker.internal:8320/v1/chat/completions",{method:"POST",body:"{}"}).then(r=>console.log(r.status))'
```

A worker cycle that logs `TypeError: fetch failed` for users with pending
classification usually means the shim is down or the host mapping is missing.
Matching crystals do not depend on this step.
