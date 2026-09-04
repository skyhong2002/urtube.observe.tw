# Keyword pipeline v2

The Insights "common keywords" cloud is produced by `src/youtube/keywords.ts`
from public video metadata only (title, YouTube tags, description). This
document is the contract for that pipeline: what the numbers mean, how the
policy is versioned, and how to change it without silently changing history.

## What a keyword row means

| Field | Meaning |
|---|---|
| `term` | Display label: the most common spelling among merged variants. |
| `key` | Canonical key (NFKC, case-folded, spacing/hyphen/hashtag removed). Variants such as `foo bar`, `foo-bar`, `#foobar` share one key. |
| `videos` | Distinct sampled videos the term appears in. This is the number the UI shows. |
| `channels` | Distinct known channels among those videos (unknown channels are not counted). |
| `score` | Source-weighted support × channel-diversity factor ÷ sampled videos. A commonness measure in the sampled range, **not** a trend or watch-time weight. |
| `sources` | How many videos contributed the term from the title, tags, or description. |
| `aliases` | Other spellings merged into this key, kept for tooltips and debugging. |

The section is named "Common keywords" (常見關鍵字) because the score does not
include recency or watch time. Renaming it back to "trending" requires adding
those signals to the score first.

## Stages

1. **Clean before segmenting.** Full URLs, bare domains (narrow TLD list in
   `keyword-lexicon.ts`; `node.js` and version numbers survive), emails,
   `@handles` and timecodes are removed; `#` is stripped so hashtags become
   ordinary text. Description lines repeated across ≥ 2 videos of one channel
   or ≥ 3 videos overall are treated as upload-template boilerplate and dropped.
2. **Segment with a fixed locale.** `Intl.Segmenter('en', word)`; tokens are
   NFKC + case-folded, edge punctuation stripped. Numeric tokens, tokens over
   40 characters, single characters, lexicon stop words, and hiragana-only
   fragments of ≤ 3 characters are dropped.
3. **Collect per video with sources.** Unigrams from title, tags and the
   surviving description lines; adjacent bigrams from the title and each tag
   only. A video contributes one weighted vote per key using its best source:
   title 3, tag 2, description 0.25 (normalized so a title hit counts 1.0).
4. **Merge safe variants** by canonical key. Translations and other semantic
   aliases are never merged automatically.
5. **Gate.** With ≥ 10 sampled videos a term needs ≥ 2 distinct videos;
   description-only terms need ≥ 3.
6. **Phrase dominance.** If ≥ 60% of a unigram's videos also carry one phrase
   built on it, the unigram yields to the phrase (`rust` → `rust async`).
   Broad words with independent use keep both (`minecraft` and
   `minecraft memes`).
7. **Score and rank.** Channel diversity is a penalty, not a gate: one channel
   keeps 80% credit, three or more channels earn 100%, so a real single-channel
   niche interest still appears. Ties resolve by videos, channels, then key
   code-point order, so output is independent of input order and runtime locale.
8. **Limit.** The dashboard and crystal show at most 20 terms; the list is
   shorter, or empty with a "not enough distinctive keywords" notice, rather
   than padded.

## Sampling and coverage

Both `Repository.youtubeDashboard()` and `Repository.youtubeCrystalWindow()`
use the same rule: distinct videos in the selected range, ordered by latest
watch, taking every *k*-th video with
`k = ceil(eligibleVideos / KEYWORD_SAMPLE_LIMIT)` (limit 2000). A 40,000-video
archive is therefore represented across its whole span instead of by its most
recent 2,000 uploads. The result carries `keywordCoverage`
(`sampledVideos`, `eligibleVideos`, `algorithmVersion`, `lexiconVersion`) and
the Insights heading shows "sampled N of M videos" whenever N < M.

## Versioning

- `KEYWORD_ALGORITHM_VERSION` (`keywords.ts`) changes when any stage, weight
  or threshold changes.
- `KEYWORD_LEXICON_VERSION` (`keyword-lexicon.ts`) changes when a stop list or
  the TLD list changes.
- `YoutubeCrystal.keywordAlgorithmVersion` records the algorithm that produced
  a crystal's keyword lists. `crystalKeywordsComparable(a, b)` returns false
  unless both crystals were produced by the current version; consumers must
  rebuild rather than compare across versions. Keywords are not part of the
  registry matching crystal and never enter matching, candidate cards or
  icebreakers.

## Changing the lexicon

Every added stop word needs a synthetic fixture in `tests/keywords.test.ts`
that proves real topic words in the same language still survive. Do not add
private titles or descriptions to fixtures. Prefer structural fixes
(boilerplate detection, cleaning patterns) over growing the lists.

## Debugging

```bash
npx tsx scripts/keyword-explain.ts --sample --terms
npx tsx scripts/keyword-explain.ts fixture.json --limit 30
```

`explainYoutubeKeywords()` returns an aggregate `summary` of reason codes
(`kept`, `beyond-limit`, `below-min-videos`, `description-only`,
`dominated-by-phrase`, `token-stopword`, `token-numeric`, `token-too-short`,
`token-too-long`, `token-short-kana`, `boilerplate-line`) that is safe to log,
plus per-candidate decisions that contain labels and must stay local.

## Change log

- **v2 / lexicon 1** (2026-09-05, #23): source-aware weighting, cleaning
  before segmentation, per-channel boilerplate removal, governed multilingual
  lexicon, canonical variant merging, phrase dominance, channel-diversity
  penalty, evenly spaced sampling with visible coverage, versioned crystal
  contract. Replaces v1 (unweighted document frequency over the latest 2,000
  or 1,000 videos with a single ad-hoc stop list and runtime-locale segmenter).
