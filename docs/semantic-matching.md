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

## Delivery boundary

This stage does not change candidate scores or publish semantic interests.
#45 adds the explicitly configured embedding service/cache, #46 weighted
DBSCAN groups, and #47-#49 the projection, score, explanations and category
filters. Until those stages are integrated, existing matching remains the
existing algorithm and must not be described as semantic matching.
