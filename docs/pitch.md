# Canonical product pitch

Use these claims consistently in the submission summary, video narration,
README, live demo, and judge Q&A. They describe the deployed product; do not
substitute an earlier formula or retired per-topic matching controls.

## One sentence

urtube turns the YouTube history a person authorizes into a reviewable private
interest map, then uses a separate, governed 90-day projection to help them
meet people with genuinely similar recent interests without publishing their
history.

## First users, first value, and return use

The initial scenario is a university maker-club member who learns coding,
music production or another hobby from YouTube and wants to find a peer for
a small project. A self-written profile can miss the niche they have actually
been exploring lately. This is a focused starting audience, not a claim that
every YouTube viewer needs another social service.

The first useful outcome does not require another member: after importing
their own history, the person can inspect watched channels, estimated time
and recent topic trends in their private dashboard, and review AI categories
when processing is ready. They can answer “what have I been spending time
learning?” even while matching says there is insufficient recent data or no
eligible candidates. Missing metadata and classification remain visible gaps;
the product does not fill them with a confident preference.

Cold start is a small, voluntary cohort proposal: invite one existing club
to try private self-insight, let each person decide whether to keep matching
enabled, then compare only when eligible peers exist. No participant counts,
successful introductions or network effects have been measured for this
proposal. Synthetic demo members demonstrate behavior and must never be
presented as acquired users or inserted into the production candidate pool.
There is no forced invitation, token reward or public-history sharing step.

A natural reason to return is a change in the person's activity: after a
week of a new tutorial series or hobby, compare recent ranges and the monthly
topic trend with the previous period. This remains useful alone. Finding a
peer is an additional outcome when the pool supports it, not a promise that
every import will produce a match. Retention and introduction outcomes still
need actual participant feedback; they are not established product metrics.

Demo evidence: the [runbook](demo-runbook.md#show-first-value-and-empty-states)
uses the real private dashboard, a newcomer with no imported history, and an
eligible member whose sole peer leaves. The two empty states stay distinct.

繁中口述：第一批先聚焦用 YouTube 自學的校園創作社群成員。匯入後先看懂
自己最近投入哪些內容，就算還沒有同好也有價值。冷啟動從一個自願參加的
社團試用開始，不宣稱已有網路效應；示範人物不是真實使用者。開始新興趣
後，回來比較近期觀看與主題趨勢，配對則等資料與同意加入的同好都足夠。

## Why AI? (under one minute)

YouTube titles, channel names, descriptions, and tags are noisy and
inconsistent, so hand-written keyword rules cannot reliably turn thousands of
videos into a useful personal map. AI handles that semantic interpretation,
but it sees public video metadata only—not searches, timestamps, watch counts,
or playback progress. Each result carries evidence and confidence; weak input
becomes `Unknown`, and a versioned candidate must pass quality gates and owner
review before activation. The owner can later roll back.

AI never decides who should meet. Two scores exist and neither is written by
a model. The overall compatibility percentage uses a source-controlled
canonical taxonomy, bounded aggregate vectors from the latest 90 days, and the
reproducible `calibrated-v2` formula. The topic compatibility (matching v3)
uses AI only to interpret public video metadata: GPT-5.6 Luna assigns each
video to fixed content genres, Gemini embeds each public tag once, weighted
DBSCAN groups a person's tags per genre, and an exact optimal-transport step
compares the two distributions. The percentage, the ordering and the shared
tags shown are deterministic computations on those cached results; no LLM
writes reasons or ranks people. Sensitive categories fail closed instead of
becoming inferred identity labels. This puts AI where semantic judgment is
useful and deterministic code where another person's privacy is at stake.

## Model input contract

| Sent to the configured model | Never sent to the model |
| --- | --- |
| Public video title | Search query |
| Public channel title | Watch timestamp or routine |
| Public description | Watch count or time |
| Public YouTube tags | Playback progress |

Low-confidence, ambiguous, or unsupported assignments do not become personal
conclusions. They are recorded as `Unknown` or blocked by the run-level quality
gates. The taxonomy audit page shows bounded evidence to the owner and requires
explicit review before activation; activation is atomic and reversible.

## Matching formula

Two versioned scores are shown side by side on `/matches` and never mixed.

**Overall compatibility (`calibrated-v2`)** computes cosine similarity independently for the canonical
topic vector and aggregate channel vector. Because broad topic cosine and
sparse channel cosine naturally occupy different scales, fixed calibration
curves map each to 0–1: topics use `(cos − 0.4) / 0.55`; channels use
`1 − e^(−25·cos)`. Available dimensions receive equal weight, or the sole
available dimension is used as fallback. The output is clamped and rounded to
a whole 0–100 percentage.

The constants are versioned in source and do not depend on the current pool,
so a pair's score does not move merely because another person joins. Profiles
need at least 200 recent events across 14 active days. Topic comparison also
needs 80% coverage for the current taxonomy; otherwise only the channel
fallback is shown.

**Topic compatibility (matching v3)** is computed per selected genre from the
most recent 2,000 distinct videos. Each public tag is embedded once
(`gemini-embedding-001`, 768 dimensions); weighted DBSCAN (cosine distance,
eps 0.2, min support 5, one unit per distinct video) keeps at most ten
clusters per genre with their mass share. For two people, every cluster pair
in the same genre gets `K = clamp((cosine − 0.7) / 0.3, 0, 1)` and an exact
optimal-transport solver maximises `Σ T·K` subject to both mass distributions,
so one tiny shared niche cannot inflate the score to 100%. Selected genres are
averaged with equal weight and rounded to 0–100. Incomplete scans, low
retained coverage, missing genre profiles or a version mismatch are labelled
provisional or unavailable; the old formula is never substituted. Details are
in [`docs/matching-v3.md`](matching-v3.md).

## Disclosure boundary

Before mutual consent, the VS page shows rounded percentages, broad topic
ranks, and each person's own rhythm as shares. After both people choose
**Want to meet**, the page may show absolute aggregate statistics, shared
channels/videos with each person's rank, and first/last watch at calendar-day
precision. Search history, exact timestamps, raw vectors/shares, introductions,
contacts, email, and private dashboards are never exchanged. Turning matching
off immediately removes the account from new discovery and withdraws active
requests and connections.

## Three-minute final pitch and judge Q&A

Timed script for the second round (five minutes total: three to present, one
for questions, one to answer). Rehearse against a stopwatch; the timings below
are targets, not measured deliveries.

| Time | Beat | Screen | Line |
| --- | --- | --- | --- |
| 0:00–0:25 | Problem | Landing page | "The interests you type into a profile are not the ones you actually spend hours on. But nobody should hand a stranger their full watch history. urtube sits between those two." |
| 0:25–1:10 | Consent, import, insight | Account → processing → private dashboard | Show Google sign-in scopes, the Takeout/extension import, the processing state, then the private interest map: channels, watch clock, topic trends and the AI genre clusters with their tag clouds. "Only public video metadata reaches a model; searches, timestamps and counts never leave this database." |
| 1:10–2:15 | Matching | `/matches` → topic view → VS compare | Pick a topic (e.g. Music + Video gaming), show real members with overall and topic percentages, open one comparison. Point at the shared tags and explain that both numbers are deterministic on cached results. |
| 2:15–2:40 | Control | Friend request → accept → withdraw; Account → matching off | Show that a private account exposes nothing beyond the percentage until both agree, and that turning matching off removes the person immediately. |
| 2:40–3:00 | Everyday value | Dashboard again | "First value is understanding your own week. Finding a peer is the bonus when the pool supports it. Open source, MIT, running at urtube.observe.tw." |

Backup if the live service fails: play the recorded clip from the demo
runbook and keep the synthetic Alice/Bob environment (`npm run demo:matching`)
running locally. Do not improvise unrelated integrations (blockchain, tokens,
sponsor APIs) to please a question.

Answers are meant to fit in 45 seconds each and point at verifiable evidence.

1. **Why is AI needed at all?** Titles, tags and descriptions are noisy and
   multilingual; keyword rules could not sort thousands of videos into
   genres or recognise that two differently worded tags mean the same
   hobby. AI does exactly that interpretation and nothing else: genre
   assignment and tag embeddings on public metadata. Ranking, percentages
   and disclosure are deterministic code (see "Matching formula"). Evidence:
   `docs/matching-v3.md`, `tests/matching-v3.test.ts`.
2. **How is the percentage computed and can it be reproduced?** Two
   versioned formulas, both documented above. `calibrated-v2` uses fixed
   calibration constants; v3 uses cached genre labels, cached tag vectors,
   weighted DBSCAN and exact optimal transport. Same inputs and same version
   give the same number; a version bump invalidates old profiles instead of
   mixing them. Evidence: `src/youtube/candidates.ts`,
   `services/matching-compute/compute.py` and its unit tests.
3. **How do you avoid sensitive inference and strangers over-reaching?**
   Political, religious, health and sexuality inferences are never matching
   features; news/politics channel labels stay owner-only insights. Before
   mutual consent a stranger sees a rounded percentage and broad genre names
   only. Vectors, masses, raw history, searches and timestamps never reach
   the browser. Evidence: `src/youtube/disclosure.ts`,
   `tests/privacy-lifecycle.test.ts`, `docs/channel-tag-policy.md`.
4. **What happens when a user withdraws or deletes?** Matching off removes
   the account from discovery immediately and withdraws pending requests
   and connections; old action tokens stop working. Deletion removes the
   Google identity, sessions, registry projections, relationships and the
   per-user SQLite file. Evidence: `tests/privacy-lifecycle.test.ts`, the
   demo runbook privacy clip.
5. **Who are the first users and how do you cold-start?** A university maker
   club learning through YouTube (see "First users, first value, and return
   use"). Self-insight is useful with zero other members; matching switches
   on when eligible peers exist. No adoption numbers are claimed; synthetic
   demo members are never in the production pool.
6. **Data volume, cost, latency and failure recovery?** Production holds
   real archives up to ~51k watch events per account; v3 profiles use the
   latest 2,000 distinct videos per person, classification runs in batches
   of up to 20 videos, and every model result is cached by content hash so
   re-runs are free. Provider 429/5xx use exponential backoff with leases and
   heartbeats; a failed account never blocks others. Measured figures live in
   `docs/backend-complexity-analysis.md` and `docs/demo-load-analysis.md`;
   anything not measured there is an estimate.
7. **What existed before the hackathon and what is new?** The YouTube
   archive import, private dashboards and the Infovore-derived ingestion
   boundary predate the event (`MIGRATION_PLAN.md`, `YOUTUBE_BOUNDARY.md`).
   Built during the hackathon: consent and matching lifecycle, `calibrated-v2`
   candidates and VS comparison, friendships and profiles, matching v3
   (genre classification, tag embeddings, clustering, optimal transport,
   topic view), governed channel labels with coverage, Komodo-based CD,
   and this documentation. The Git history on `main` is the record.
