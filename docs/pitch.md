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

AI never decides who should meet. Cross-user matching uses a source-controlled
canonical taxonomy, bounded aggregate vectors from the latest 90 days, and the
reproducible `calibrated-v2` formula. Sensitive categories fail closed instead
of becoming inferred identity labels. This puts AI where semantic judgment is
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

`calibrated-v2` computes cosine similarity independently for the canonical
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

## Disclosure boundary

Before mutual consent, the VS page shows rounded percentages, broad topic
ranks, and each person's own rhythm as shares. After both people choose
**Want to meet**, the page may show absolute aggregate statistics, shared
channels/videos with each person's rank, and first/last watch at calendar-day
precision. Search history, exact timestamps, raw vectors/shares, introductions,
contacts, email, and private dashboards are never exchanged. Turning matching
off immediately removes the account from new discovery and withdraws active
requests and connections.
