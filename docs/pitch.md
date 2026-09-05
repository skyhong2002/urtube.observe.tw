# Canonical product pitch

Use these claims consistently in the submission summary, video narration,
README, live demo, and judge Q&A. They describe the deployed product; do not
substitute an earlier formula or retired per-topic matching controls.

## One sentence

urtube turns the YouTube history a person authorizes into a reviewable private
interest map, then uses a separate, governed 90-day projection to help them
meet people with genuinely similar recent interests without publishing their
history.

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
