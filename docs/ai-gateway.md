# AI classification gateway

Both GPT classifiers call the central ai-gateway (CLIProxyAPI on sky-mini,
source and model policy in the operator's `ai-gateway` repository). It serves
an OpenAI-compatible `/v1/chat/completions` and bills one ChatGPT subscription
(`gpt@nycu.one`) shared with other projects. Gemini embeddings stay on Google.

Since 2026-10-02 production uses:

| Classifier | Setting | Request model | Resolves to (2026-10-02) |
|---|---|---|---|
| Personal taxonomy | `AI_MODEL` | `sky-quality` | `gpt-6.1-sol` |
| Matching v3 genres and channel types | `MATCHING_V3_CLASSIFICATION_MODEL` | `sky-fast` | `gpt-6-luna` |

The code and CD never name a concrete request model. CD (`deploy/komodo/release.py`)
sets the two aliases; the gateway's `model-policy.json` decides what they resolve
to, so a model upgrade needs no urtube release. Both send `reasoning_effort: low`
and `response_format: json_object`. `temperature` is sent only when
`AI_TEMPERATURE` is set (default omitted; reasoning models reject non-default
values). This replaces the earlier rule that sniffed the `api.openai.com` host.

This reverses the 2026-09-08 decision to bill urtube to the OpenAI Platform API.
The OpenAI key is no longer used by any service; the pre-migration env files are
kept on the host as `*.env.pre-ai-gateway-20261002`.

## Endpoint and credentials

Host-owned Komodo env files (`/home/urtube/komodo/*.env`, mode 600) hold:

- `AI_BASE_URL` and `MATCHING_V3_BASE_URL`: `http://100.71.224.62:8318/v1`, the
  gateway's Tailscale-only listener. skyhong-sm and its containers reach it
  through the host's tailnet route; no `extra_hosts` entry is needed.
- `AI_API_KEY` and `MATCHING_V3_API_KEY`: the gateway client key named `urtube`.
  Never commit it.

## Provenance

The gateway reports the resolved upstream model in the response `model` field.

- Matching operations store `requestedModel` (`sky-fast`) and `returnedModel`
  (for example `gpt-6-luna`) in `matching_v3_operations.usage_json`.
- Personal taxonomy rows keep the stable contract model of their run (see
  below). Each worker classification pass logs one JSON line
  `{"personalClassification":{...,"requestedModel":"sky-quality","returnedModels":["gpt-6.1-sol"]}}`.
  Storing the returned model per row would need a schema change and is not done.

## Preserving completed work

Switching to aliases must not reclassify videos that are already done.

- Personal taxonomy runs are keyed by (definition, model, prompt). Every
  existing run uses `gpt-5.6-sol`. CD sets `AI_REUSE_MODEL=gpt-6-sol,gpt-5.6-sol`
  (comma-separated, preferred in order), so an account keeps finishing its
  existing run with `sky-quality` and only unfinished videos are sent. New
  accounts and explicit rebuilds create `sky-quality` runs; later gateway model
  changes keep that contract, so they never trigger a rebuild. These IDs are
  never sent upstream. Existing rows are not relabeled.
- Matching caches and profile versions are keyed by
  `MATCHING_V3_CLASSIFICATION_CACHE_NAMESPACE` (host-owned, pinned to the
  original `http://host.docker.internal:8320/v1`) and
  `MATCHING_V3_CLASSIFICATION_CACHE_MODEL=gpt-5.6-luna` (set by CD). Both are
  identity strings only. Keep them unchanged, or every video, channel and profile
  is reclassified.

## Concurrency

The subscription is shared, so the host env files cap urtube below its former
OpenAI API settings:

- `AI_CONCURRENCY=3` (was 6): personal taxonomy requests in flight, 20 videos each.
- `MATCHING_V3_CONCURRENCY=4` (was 10000): matching GPT requests in flight.
  Gemini keeps its own uncapped queue.
- Unchanged: `MATCHING_V3_CALLS_PER_CYCLE=0`, `MATCHING_V3_DAILY_API_CALLS=0`,
  batch size 20, `AI_TIMEOUT_MS=300000`, and the 5,000-video source limit.
  Gateway 429/5xx responses use the existing retry and backoff.

## Checks

```sh
ssh urtube@skyhong-sm
export PATH=/home/.docker-engine/bin:$PATH
# from a container: 401 without the key
docker exec urtube-worker node -e 'fetch("http://100.71.224.62:8318/v1/models").then(r=>console.log(r.status))'
docker logs --since 1h urtube-worker 2>&1 | grep personalClassification
```

A worker cycle that logs `TypeError: fetch failed` for users with pending
classification means the gateway or the tailnet route is down. Matching
crystals do not depend on this step.

## Retired: Codex shim

Before 2026-09-08 production used `~/bin/codex-openai-shim.mjs`
(`systemctl --user status urtube-codex-shim`, bound to `172.17.0.1:8320`).
The unit is inactive and nothing points at it; its address survives only as
the matching cache namespace.
