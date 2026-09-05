# Evidence-backed semantic tags implementation plan

**Goal:** Implement #44's canonical multi-category public-metadata tags as the first persisted stage of the semantic matching pipeline.

**Architecture:** Reuse the chat JSON client and shared limiter. A pure bounded validator in `src/youtube/semantic-tags.ts` checks canonical categories, exact public evidence and sensitive exclusions. Each video's result atomically replaces one versioned record in its owner's SQLite; fresh results are reused and failed batches remain retryable. The worker runs this stage independently of private taxonomy activation.

**Tech stack:** Existing TypeScript, Zod, node:sqlite, Node test runner and chat-completions client; no new dependency.

1. Add `tests/semantic-tags.test.ts` with synthetic public metadata and model responses: multi-category tags, duplicate/missing IDs, unsupported evidence, sensitive labels, noisy raw tags, low confidence/empty result, unavailable metadata, idempotency, model/metadata invalidation, stale concurrent writes and persisted failure/retry.
2. Run the new checks to confirm missing behavior.
3. Export the existing default chat client and JSON request function from `src/youtube/ai.ts`. Add a bounded semantic contract, schema and public-only batch input/validation module; preserve private taxonomy behavior.
4. Add schema 14 and Repository queue/read/save methods in `src/data/database.ts`; include records in owner export and existing full-database backup/deletion. Use current metadata hashes to reject stale writes and reads.
5. Add the semantic stage and pending-work check to `src/youtube-worker.ts`. Persist unavailable/error/progress state; honor model config and existing per-user error isolation.
6. Document the exact contract, limits, privacy and enabled/unavailable states in `docs/semantic-matching.md`. Future #45-#49 consume this stage; do not claim embeddings or semantic scoring are delivered by #44.
7. Run `npm run check`, inspect all affected callers, get independent review, and open a separate PR. Re-read issue ownership and current main before starting the next pipeline stage.
