# Channel Tag Governance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make channel classifications traceable, non-personifying, unavailable when their source cannot be verified, and explicitly excluded from matching.

**Architecture:** Keep the existing external `channels_list` API and in-memory TTL cache. Wrap the seven sets in one verified snapshot carrying the upstream time and a deterministic SHA-256 membership version; propagate that metadata into the existing pure aggregation and renderer. Publish the semantic policy in one source-controlled document linked from the UI.

**Tech Stack:** TypeScript, Node.js built-in `crypto`, Hono server-rendered HTML, `node:test`.

---

## Design

The accepted Issue #17 contract is authoritative. Three implementation shapes were considered:

1. A source-controlled policy version alone is too weak because upstream membership can change without a code change.
2. An API timestamp plus a deterministic hash of sorted group membership is the smallest complete option. It detects source changes, needs no database or dependency, and keeps the existing refresh model.
3. Vendoring all lists would provide rollback snapshots but create a second synchronization workflow that this Issue does not request.

Use option 2. A snapshot is valid only when every group returns an array and a source timestamp. The cache may serve a verified snapshot within its six-hour TTL, but a failed refresh must reject instead of falling back to an expired copy. The existing route catch then renders only the unavailable state.

The UI describes channel labels and watch-time distribution, never the viewer's political identity. It shows overall tag coverage, policy version, membership hash, source time, definitions, limitations, and a report link. Matching remains on the separate canonical taxonomy already established by #14.

No schema migration is needed. Existing data stays unchanged.

### Task 1: Lock the source contract with failing tests

**Files:**
- Modify: `tests/taglean.test.ts`

**Steps:**

1. Add a synthetic snapshot helper and update aggregation/render calls.
2. Mock `globalThis.fetch` and assert that sorted membership has a stable hash, changed membership changes the hash, a missing upstream time rejects, and an expired snapshot is not reused after a refresh failure.
3. Assert English and Traditional Chinese output use channel-classification language, include provenance/policy/report links, and do not render a dominant-camp identity headline.
4. Run `node --import tsx --test tests/taglean.test.ts`; expect failure before implementation.

### Task 2: Add verified snapshots and fail closed

**Files:**
- Modify: `src/youtube/taglists.ts`
- Modify: `src/index.ts`

**Steps:**

1. Add immutable policy metadata and a `TagListSnapshot` type containing lists, source time, fetch time, and membership version.
2. Validate every API payload's `result` and `time`.
3. Hash canonical sorted `group:channel-id` rows with Node's built-in SHA-256.
4. Cache only a complete snapshot and delete the stale-on-error fallback.
5. Pass the snapshot through `computeTagLean`.
6. Run the focused test; expect provenance and fetch behavior assertions to pass.

### Task 3: Make the UI accurate and traceable

**Files:**
- Modify: `src/output/taglean.ts`
- Modify: `src/output/i18n.ts`

**Steps:**

1. Rename the surface to channel classifications and remove the dominant political-camp hero.
2. Keep the distribution bars and direct labels, scoped as labels on channels rather than identity claims about the viewer.
3. Render coverage, policy/data versions, source time, definitions/limitations link, matching exclusion, and error-report link.
4. Run the focused test; expect all UI assertions to pass.

### Task 4: Publish governance and verify the boundary

**Files:**
- Create: `docs/channel-tag-policy.md`
- Modify: `YOUTUBE_BOUNDARY.md`

**Steps:**

1. Document every tag group's inclusion/query rule, the channel-not-person interpretation, provenance/version scheme, review/change-log process, failure behavior, report path, and matching exclusion.
2. Link the policy from the privacy boundary and state that political/taglean fields never enter matching.
3. Run `npm run check`; expect typecheck and all tests to pass.

### Task 5: Deliver one Issue commit

**Files:**
- All files above.

**Steps:**

1. Review `git diff --check`, `git diff --stat`, and the full diff.
2. Create exactly one non-closing commit: `Issue #17: govern channel classifications`.
3. Push `codex/issue-17-channel-tag-governance`.
4. Verify the remote commit and rerun the complete gate on the pushed HEAD.
5. Comment `READY_FOR_DEPLOY` with remote branch ref, commit, test results, migration status, and risks. Do not deploy or close the Issue.
