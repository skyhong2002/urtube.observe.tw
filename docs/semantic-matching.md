# Semantic matching pipeline

## Stage 1: evidence-backed tags (#44)

The worker extracts bounded tags from public video metadata using the existing
chat-completions client, credentials and shared request limiter. Enable with
the documented `AI_CLASSIFICATION_ENABLED`, `AI_API_KEY`, `AI_MODEL` and
`AI_BASE_URL` settings. No embedding endpoint is assumed or invoked by this
stage. Without the configured chat capability it records `unavailable`.

Each request contains only canonical taxonomy definitions and video IDs,
titles (300 characters), descriptions (700 characters) and up to 20 cleaned
original tags. Unicode normalization, existing URL/contact cleaning and stop
lists remove noise and duplicate raw tags. Keyword-cloud source weights are
not used. Searches, watch times/counts, progress and user identity are absent.

The response contract is `{videos:[{videoId,tags:[{categoryKey,label,source,
evidence,confidence}]}]}`. `source` is `tag`, `title` or `description`. Every
video ID must appear once, with at most three canonical categories and five
distinct tags per category. Confidence below 0.7 yields no tag. Both the label
and its verbatim evidence must be supported by the bounded public input;
missing IDs, duplicates, invented evidence or invalid schemas fail the batch.
An empty array is a valid completed result, not a missing model answer.

Metadata instructions are untrusted data. Labels describe content, never a
viewer's identity. News & Politics (25) and Nonprofits & Activism (29) videos
are excluded before requests. The prompt prohibits sensitive identity labels;
validation also rejects explicit political, religious, health-condition and
sexual-orientation terms. This lexical guard is deliberately conservative,
not a claim to infer or recognize every sensitive meaning in every language.
No semantic tags are shared to the matching registry in this stage.

## Persistence, bounds and retry

Schema 14 adds `youtube_semantic_tags` to each user's SQLite database. One
atomic result per video holds tags, `ready/empty/excluded/unavailable/error`,
the current public metadata hash, the complete model/schema/prompt/taxonomy/
lexicon contract and update time. A model/prompt/metadata change makes old
results unreadable by the current contract and requeues only affected videos.
Writes from a stale metadata request cannot replace a newer result. Completed
empty/excluded/unavailable rows do not generate endless repeated requests.
Videos still waiting for metadata remain pending and are not sent to AI.

A cycle handles at most 1,000 videos, newest watches first, in batches of 20.
The existing shared FIFO limiter bounds model concurrency and its configured
timeout bounds each call. Each failed batch gets at most three attempts per
cycle, then a persistent error and one-hour cooldown measured from completion.
Successful batches are saved even when another batch fails. Accounts and the
existing private classifier remain isolated from semantic failures. The
`semantic_tags_status` sync entry and current-contract
Repository counts expose progress without making UI requests call the model.

Owner export includes `semantic-tags.json`; existing full-database backups
and account-file deletion cover the new table. No user relation is placed in
a public cache. Model-service failure details are kept generic so response
content or credentials do not leak into worker status.

## Stage 2: background embeddings (#45)

The separate `/embeddings` client requires explicit `EMBEDDING_BASE_URL`,
`EMBEDDING_MODEL` and `EMBEDDING_MODEL_REVISION`. It never reads chat URL/model
settings. Missing configuration is `unavailable`. A configured but failing or
incompatible service produces persistent `error` state; it never completes
with fabricated vectors. Every actual response is a capability check: model,
count, unique complete indices, exactly 1024 finite values and nonzero norm.
Vectors are L2-normalized locally, without truncation or padding.

The registry's `embedding_cache` stores only normalized public labels,
vectors, the model/weights/schema/preprocessing contract and request state.
NFKC/case/whitespace normalization preserves punctuation. Fresh per-video tags
remain the only owner relation, in each owner's database; changed metadata
or tag contracts stop supplying stale labels immediately. Different model
revisions use separate cache rows and are never mixed. Operators must change
the revision whenever deployed weights change; the API cannot prove weights
identity from a model name alone. Existing whole-registry backups include
the cache. Deleting an account removes its archive and all derived relations;
unattributed public vectors can remain reusable by other accounts.

After tags, each cycle embeds up to 1024 distinct missing labels, in batches
of 64. The single deployed worker has a shared two-request FIFO limit and
60-second request timeout. Each batch has three total attempts, then a
one-hour cooldown from failure completion. Atomic SQLite claims prevent
overlapping accounts/processes from requesting the same label. A 210-second
lease starts after acquiring a request slot; interruption allows later
reclaim and a token guard prevents obsolete workers from overwriting it.
Completed batches survive other failures, including private-classifier
failures. Run one worker process per deployment to keep the two-request
service-wide concurrency budget.

`semantic_embeddings_progress` stores the latest owner-local progress
snapshot. Call `semanticEmbeddingProgress()` for current contract-aware
counts/status after imports or configuration changes; it is read-only.
`embeddingWorkPending()` drives catch-up for due work. UI queries do not call
the model. Empty archives or completed tags with no valid labels require no
embedding request; downstream eligibility still decides whether matching has
enough data.

### Self-hosted setup and capability check

The selected model is [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3), whose
dense vectors have 1024 dimensions. The optional Compose file pins
[vLLM 0.28.0](https://github.com/vllm-project/vllm/releases/tag/v0.28.0), uses
the documented [BGE-M3 architecture override](https://docs.vllm.ai/en/v0.17.0/models/pooling_models/#baaibge-m3),
and selects the dense `embed` task via its
[pooler configuration](https://github.com/vllm-project/vllm/blob/v0.28.0/vllm/config/pooler.py).
It requires a Linux NVIDIA GPU host with Docker Compose GPU support,
NVIDIA Container Toolkit and a driver compatible with the pinned image's
CUDA 13.0 runtime. No GPU memory or throughput measurement is claimed here.

In `.env`, add a dedicated random key (generate with `openssl rand -hex 32`)
and these explicit values. The weights revision was checked against the
official model repository on 2026-09-05:

```dotenv
EMBEDDING_BASE_URL=http://embeddings:8000/v1
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_MODEL_REVISION=5617a9f61b028005a4858fdac845db406aefb181
EMBEDDING_API_KEY=replace-with-your-generated-key
```

```sh
docker compose -f docker-compose.yml -f docker-compose.embeddings.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.embeddings.yml logs --tail=50 embeddings
docker compose -f docker-compose.yml -f docker-compose.embeddings.yml exec worker npm run embeddings:check
```

The model endpoint is available only on the Compose network. The check sends
two public fixture labels and exits nonzero unless the real service satisfies
the full contract. Successful validation prints the contract, never the key
or vectors. For a native app, explicitly set the same variables for an
accessible dedicated endpoint and run `npm run embeddings:check`; do not use
the Compose-only hostname. npm scripts inherit environment variables; to use
a local `.env` explicitly run
`node --env-file=.env --import tsx scripts/check-embeddings.ts`.

Local checks cover synthetic HTTP responses, concurrency, version changes,
restart/lease recovery, stale writes, privacy and failure isolation. The GPU
image/model was not started in this development workspace; external service
capability and deployment acceptance remain to be run on the intended host.

## Delivery boundary

Tags and vectors do not yet replace candidate scores or publish semantic
interests. #46 adds weighted DBSCAN groups; #47–#49 integrate projection,
scores, explanations and category filters. Until those stages are integrated,
existing matching must not be described as semantic matching.
