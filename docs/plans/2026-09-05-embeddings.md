# Background embedding cache (#45)

Use the existing SQLite registry for a public-label-only cache and its atomic conditional updates for expiring request leases. Keep user-to-video-to-tag relations in owner databases. Reuse the service limiter; no new dependency or chat fallback. The embedding contract pins model, weights revision, 1024 dimensions, L2 normalization and label preprocessing.

1. Add a strict OpenAI-compatible embeddings client with separate explicit configuration and a runnable capability probe.
2. Add cache read/claim/finish methods. Deduplicate across accounts and worker processes; persist failures and completion-time cooldowns; expired leases recover after interruption.
3. Read only fresh canonical semantic tags from each archive. Run embeddings after tags, independently of private taxonomy, with live contract-aware progress and bounded worker catch-up.
4. Verify malformed indices/counts/dimensions/nonfinite/zero vectors, normalization, shared-label concurrency, version invalidation, restart/leases, failures and account deletion.
5. Document pinned self-hosting setup and distinguish synthetic local checks from external GPU/service acceptance. Run the full check and independent review; open a stacked PR on #44.
