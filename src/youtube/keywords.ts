// Keyword pipeline v2: deterministic, source-aware keyword extraction from
// public video metadata (title, YouTube tags, description).
//
// Stages, in order:
//   1. clean   — strip URLs, bare domains, emails, @handles, timecodes and
//                per-channel description boilerplate *before* segmentation.
//   2. segment — fixed-locale Intl.Segmenter, NFKC + case folding, governed
//                stop lists (see keyword-lexicon.ts), numeric/kana rules.
//   3. collect — per video, candidates keep their source (title/tag/desc);
//                unigrams from every source, adjacent bigrams from titles
//                and tags only. Each video contributes at most once per key.
//   4. merge   — safe format variants (`foo bar` / `foo-bar` / `#foobar`)
//                share a canonical key; the most common spelling is the
//                display label and the others are kept as aliases.
//   5. gate    — minimum distinct videos; description-only terms need more.
//   6. dominate— a unigram mostly covered by one phrase yields to it.
//   7. score   — source-weighted support × channel-diversity factor,
//                normalized by the sampled video count.
//
// The score is *not* a trend: it measures how commonly a term appears across
// the sampled videos, so the UI names the section "common keywords" and
// shows the distinct video count. Every constant lives in KEYWORD_POLICY so
// behaviour is testable and versioned; results are independent of input
// order and of the runtime locale.
import {
  BARE_DOMAIN_TLDS,
  KEYWORD_LEXICON_VERSION,
  KEYWORD_STOP_SET,
} from './keyword-lexicon.js';
import type { YoutubeKeyword, YoutubeKeywordCoverage } from './types.js';

export const KEYWORD_ALGORITHM_VERSION = 2;
// Dashboard and crystal windows sample the same number of distinct videos
// with the same stride rule, so both surfaces rank identically.
export const KEYWORD_SAMPLE_LIMIT = 2000;
export const KEYWORD_DEFAULT_LIMIT = 20;

export type KeywordSource = 'title' | 'tag' | 'description';

export const KEYWORD_POLICY = {
  algorithmVersion: KEYWORD_ALGORITHM_VERSION,
  lexiconVersion: KEYWORD_LEXICON_VERSION,
  // Fixed segmentation locale; ICU's CJK dictionaries do not depend on it,
  // but pinning it removes the runtime-default variable entirely.
  segmenterLocale: 'en',
  sourceWeights: { title: 3, tag: 2, description: 0.25 } as Record<KeywordSource, number>,
  descriptionMaxChars: 600,
  // A description line repeated across this many videos of one channel is
  // upload-template boilerplate; across any channels, this many is enough.
  boilerplateChannelVideos: 2,
  boilerplateGlobalVideos: 3,
  // Support thresholds (distinct videos).
  largeSampleThreshold: 10,
  minVideosLargeSample: 2,
  descriptionOnlyMinVideos: 3,
  // A unigram whose videos are ≥ this share covered by a single phrase is
  // redundant with that phrase.
  phraseDominance: 0.6,
  // Channel diversity is a penalty, never an exclusion: one channel keeps
  // 80% credit, three or more channels earn full credit.
  channelFactorFloor: 0.8,
  channelFullCreditAt: 3,
  maxTokenLength: 40,
  bigramWindow: 40,
  // Hiragana-only fragments up to this length are conjugation glue.
  shortKanaMax: 3,
} as const;

export interface KeywordSourceRow {
  title: string;
  description: string | null;
  tags_json: string | null;
  channel_id?: string | null;
}

export type KeywordReason =
  | 'kept'
  | 'beyond-limit'
  | 'below-min-videos'
  | 'description-only'
  | 'dominated-by-phrase'
  | 'token-stopword'
  | 'token-numeric'
  | 'token-too-short'
  | 'token-too-long'
  | 'token-short-kana'
  | 'boilerplate-line';

export interface KeywordExplanation {
  keywords: YoutubeKeyword[];
  algorithmVersion: number;
  lexiconVersion: number;
  sampledVideos: number;
  // Aggregate counts only — safe to log in production.
  summary: Record<KeywordReason, number>;
  // Candidate-level decisions for fixtures and local debugging. Contains the
  // candidate labels, so never emit this for real archives in logs.
  candidates: Array<{ key: string; term: string; videos: number; reason: KeywordReason; by?: string }>;
}

const segmenter = new Intl.Segmenter(KEYWORD_POLICY.segmenterLocale, { granularity: 'word' });

const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/giu;
const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/giu;
const BARE_DOMAIN_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}@])(?:[\\p{L}\\p{N}-]+\\.)+(?:${BARE_DOMAIN_TLDS.join('|')})(?:/[^\\s]*)?(?![\\p{L}\\p{N}])`,
  'giu',
);
const HANDLE_PATTERN = /(?<![\p{L}\p{N}])@[\p{L}\p{N}_.]+/giu;
const TIMECODE_PATTERN = /(?<![\p{N}])\d{1,2}:\d{2}(?::\d{2})?(?![\p{N}])/gu;
const HASHTAG_PATTERN = /(?<![\p{L}\p{N}])#(?=[\p{L}\p{N}])/gu;
const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
const NUMERIC_TOKEN = /^[\p{N}.,%]+$/u;
const HIRAGANA_ONLY = /^\p{Script=Hiragana}+$/u;
// Katakana compounds (マインクラフト) are one word; ICU splits unknown ones,
// so adjacent katakana segments are re-joined before filtering.
const KATAKANA_ONLY = /^[\p{Script=Katakana}ー]+$/u;
const VARIANT_SEPARATORS = /[\s\-_'’.·]+/gu;

// Removes machine-readable noise that would otherwise survive segmentation
// as plausible-looking words (`gmail`, `com`, `tiktok`, `12`).
export function cleanKeywordText(value: string): string {
  return value
    .replace(URL_PATTERN, ' ')
    .replace(EMAIL_PATTERN, ' ')
    .replace(BARE_DOMAIN_PATTERN, ' ')
    .replace(HANDLE_PATTERN, ' ')
    .replace(TIMECODE_PATTERN, ' ')
    .replace(HASHTAG_PATTERN, '');
}

export function normalizeKeywordToken(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(EDGE_PUNCTUATION, '');
}

// Format variants that are safe to merge: spacing, hyphens, underscores,
// apostrophes and hashtag concatenation. Translations and other aliases are
// never merged automatically.
export function canonicalKeywordKey(label: string): string {
  return label.replace(VARIANT_SEPARATORS, '');
}

type Counter = Record<KeywordReason, number>;

function emptySummary(): Counter {
  return {
    'kept': 0, 'beyond-limit': 0, 'below-min-videos': 0, 'description-only': 0,
    'dominated-by-phrase': 0, 'token-stopword': 0, 'token-numeric': 0, 'token-too-short': 0,
    'token-too-long': 0, 'token-short-kana': 0, 'boilerplate-line': 0,
  };
}

function wordSegments(value: string): string[] {
  const words: string[] = [];
  let contiguous = false;
  for (const segment of segmenter.segment(cleanKeywordText(value))) {
    if (!segment.isWordLike) { contiguous = false; continue; }
    const previous = words[words.length - 1];
    if (contiguous && previous && KATAKANA_ONLY.test(previous) && KATAKANA_ONLY.test(segment.segment)) {
      words[words.length - 1] = previous + segment.segment;
    } else {
      words.push(segment.segment);
    }
    contiguous = true;
  }
  return words;
}

function tokenize(value: string, summary: Counter): string[] {
  const out: string[] = [];
  for (const word of wordSegments(value)) {
    const token = normalizeKeywordToken(word);
    if (!token) continue;
    if (token.length > KEYWORD_POLICY.maxTokenLength) { summary['token-too-long'] += 1; continue; }
    if (NUMERIC_TOKEN.test(token)) { summary['token-numeric'] += 1; continue; }
    if (KEYWORD_STOP_SET.has(token)) { summary['token-stopword'] += 1; continue; }
    if (token.length < 2) { summary['token-too-short'] += 1; continue; }
    if (HIRAGANA_ONLY.test(token) && token.length <= KEYWORD_POLICY.shortKanaMax) {
      summary['token-short-kana'] += 1;
      continue;
    }
    out.push(token);
  }
  return out;
}

function parseTags(tagsJson: string | null): string[] {
  try {
    const parsed = JSON.parse(tagsJson ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function descriptionLines(description: string | null): string[] {
  return (description ?? '')
    .slice(0, KEYWORD_POLICY.descriptionMaxChars)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function lineKey(line: string): string {
  return normalizeKeywordToken(line).replace(/\s+/gu, ' ');
}

// Lines that a channel pastes under every upload (links, CTAs, schedules)
// describe the channel, not the viewer's interest. Detected structurally by
// repetition instead of by ever-growing stop lists.
function boilerplateLines(rows: KeywordSourceRow[]): Set<string> {
  const perChannel = new Map<string, Map<string, number>>();
  const global = new Map<string, number>();
  rows.forEach((row, index) => {
    const channel = row.channel_id ?? `unknown:${index}`;
    const seen = new Set(descriptionLines(row.description).map(lineKey));
    for (const key of seen) {
      global.set(key, (global.get(key) ?? 0) + 1);
      let counts = perChannel.get(channel);
      if (!counts) perChannel.set(channel, (counts = new Map()));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  const result = new Set<string>();
  for (const [key, count] of global) {
    if (count >= KEYWORD_POLICY.boilerplateGlobalVideos) result.add(key);
  }
  for (const counts of perChannel.values()) {
    for (const [key, count] of counts) {
      if (count >= KEYWORD_POLICY.boilerplateChannelVideos) result.add(key);
    }
  }
  return result;
}

interface VideoCandidate {
  label: string;
  weight: number;
  sources: Set<KeywordSource>;
  parts: [string, string] | null;
}

function candidatesForVideo(
  row: KeywordSourceRow,
  boilerplate: Set<string>,
  summary: Counter,
): Map<string, VideoCandidate> {
  const candidates = new Map<string, VideoCandidate>();
  const add = (label: string, source: KeywordSource, parts: [string, string] | null) => {
    if (label.length < 2) return;
    const key = canonicalKeywordKey(label);
    if (key.length < 2) return;
    const weight = KEYWORD_POLICY.sourceWeights[source];
    const existing = candidates.get(key);
    if (existing) {
      existing.sources.add(source);
      if (weight > existing.weight) {
        existing.weight = weight;
        existing.label = label;
      }
      if (!existing.parts && parts) existing.parts = parts;
      return;
    }
    candidates.set(key, { label, weight, sources: new Set([source]), parts });
  };
  const addList = (tokens: string[], source: KeywordSource, phrases: boolean) => {
    for (const token of tokens) add(token, source, null);
    if (!phrases) return;
    const window = tokens.slice(0, KEYWORD_POLICY.bigramWindow);
    window.forEach((token, index) => {
      const next = window[index + 1];
      if (next) add(`${token} ${next}`, source, [canonicalKeywordKey(token), canonicalKeywordKey(next)]);
    });
  };
  addList(tokenize(row.title, summary), 'title', true);
  for (const tag of parseTags(row.tags_json)) addList(tokenize(tag, summary), 'tag', true);
  const kept = descriptionLines(row.description).filter((line) => {
    if (boilerplate.has(lineKey(line))) { summary['boilerplate-line'] += 1; return false; }
    return true;
  });
  if (kept.length) addList(tokenize(kept.join('\n'), summary), 'description', false);
  return candidates;
}

interface Aggregate {
  key: string;
  labels: Map<string, number>;
  videos: number;
  channels: Set<string>;
  hasUnknownChannel: boolean;
  support: number;
  sources: Record<KeywordSource, number>;
  parts: [string, string] | null;
}

function pickLabel(labels: Map<string, number>): { term: string; aliases: string[] } {
  // Most frequent spelling wins; ties prefer the spaced (readable) form,
  // then the shorter one, then code-point order so output is stable.
  const ordered = [...labels.entries()].sort(([a, countA], [b, countB]) =>
    countB - countA
    || Number(b.includes(' ')) - Number(a.includes(' '))
    || a.length - b.length
    || (a < b ? -1 : a > b ? 1 : 0),
  );
  return { term: ordered[0][0], aliases: ordered.slice(1).map(([label]) => label) };
}

function channelFactor(aggregate: Aggregate): number {
  // Unknown channels neither earn nor lose diversity credit.
  if (aggregate.channels.size === 0) return 1;
  const span = KEYWORD_POLICY.channelFullCreditAt - 1;
  const progress = Math.min(span, aggregate.channels.size - 1) / span;
  return KEYWORD_POLICY.channelFactorFloor + (1 - KEYWORD_POLICY.channelFactorFloor) * progress;
}

export function explainYoutubeKeywords(
  rows: KeywordSourceRow[],
  limit = KEYWORD_DEFAULT_LIMIT,
): KeywordExplanation {
  const summary = emptySummary();
  const boilerplate = boilerplateLines(rows);
  const aggregates = new Map<string, Aggregate>();
  for (const row of rows) {
    for (const [key, candidate] of candidatesForVideo(row, boilerplate, summary)) {
      let aggregate = aggregates.get(key);
      if (!aggregate) {
        aggregate = {
          key, labels: new Map(), videos: 0, channels: new Set(), hasUnknownChannel: false,
          support: 0, sources: { title: 0, tag: 0, description: 0 }, parts: null,
        };
        aggregates.set(key, aggregate);
      }
      aggregate.labels.set(candidate.label, (aggregate.labels.get(candidate.label) ?? 0) + 1);
      aggregate.videos += 1;
      if (row.channel_id) aggregate.channels.add(row.channel_id);
      else aggregate.hasUnknownChannel = true;
      // Per-video contribution cap: one weighted vote from the best source.
      aggregate.support += candidate.weight / KEYWORD_POLICY.sourceWeights.title;
      for (const source of candidate.sources) aggregate.sources[source] += 1;
      if (!aggregate.parts && candidate.parts) aggregate.parts = candidate.parts;
    }
  }

  const sampledVideos = rows.length;
  const minVideos = sampledVideos >= KEYWORD_POLICY.largeSampleThreshold
    ? KEYWORD_POLICY.minVideosLargeSample : 1;
  const decisions = new Map<string, { reason: KeywordReason; by?: string }>();
  const survivors = new Map<string, Aggregate>();
  for (const aggregate of aggregates.values()) {
    if (aggregate.videos < minVideos) {
      decisions.set(aggregate.key, { reason: 'below-min-videos' });
      continue;
    }
    const descriptionOnly = aggregate.sources.title === 0 && aggregate.sources.tag === 0;
    if (descriptionOnly && aggregate.videos < KEYWORD_POLICY.descriptionOnlyMinVideos) {
      decisions.set(aggregate.key, { reason: 'description-only' });
      continue;
    }
    survivors.set(aggregate.key, aggregate);
  }

  // Phrase dominance: when most of a word's videos also carry one specific
  // phrase built on it, the phrase is the informative item.
  for (const phrase of survivors.values()) {
    if (!phrase.parts) continue;
    for (const part of phrase.parts) {
      const unigram = survivors.get(part);
      if (!unigram || unigram === phrase || unigram.parts) continue;
      if (phrase.videos >= KEYWORD_POLICY.phraseDominance * unigram.videos) {
        decisions.set(part, { reason: 'dominated-by-phrase', by: phrase.key });
      }
    }
  }
  for (const key of decisions.keys()) survivors.delete(key);

  const ranked = [...survivors.values()]
    .map((aggregate) => {
      const { term, aliases } = pickLabel(aggregate.labels);
      const keyword: YoutubeKeyword = {
        term,
        key: aggregate.key,
        videos: aggregate.videos,
        channels: aggregate.channels.size,
        score: Math.round(aggregate.support * channelFactor(aggregate) / Math.max(1, sampledVideos) * 1000) / 1000,
        sources: { ...aggregate.sources },
        aliases,
      };
      return keyword;
    })
    .sort((a, b) =>
      b.score - a.score
      || b.videos - a.videos
      || b.channels - a.channels
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
  const keywords = ranked.slice(0, Math.max(0, limit));
  ranked.forEach((keyword, index) => {
    decisions.set(keyword.key, { reason: index < limit ? 'kept' : 'beyond-limit' });
  });

  const candidates = [...aggregates.values()]
    .map((aggregate) => {
      const decision = decisions.get(aggregate.key) ?? { reason: 'below-min-videos' as KeywordReason };
      return { key: aggregate.key, term: pickLabel(aggregate.labels).term, videos: aggregate.videos, ...decision };
    })
    .sort((a, b) => b.videos - a.videos || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const candidate of candidates) summary[candidate.reason] += 1;

  return {
    keywords,
    algorithmVersion: KEYWORD_ALGORITHM_VERSION,
    lexiconVersion: KEYWORD_LEXICON_VERSION,
    sampledVideos,
    summary,
    candidates,
  };
}

export function extractYoutubeKeywords(
  rows: KeywordSourceRow[],
  limit = KEYWORD_DEFAULT_LIMIT,
): YoutubeKeyword[] {
  return explainYoutubeKeywords(rows, limit).keywords;
}

export function keywordCoverage(sampledVideos: number, eligibleVideos: number): YoutubeKeywordCoverage {
  return {
    sampledVideos,
    eligibleVideos,
    algorithmVersion: KEYWORD_ALGORITHM_VERSION,
    lexiconVersion: KEYWORD_LEXICON_VERSION,
  };
}

// Stride for the database-side evenly spaced sample: every k-th distinct
// video in watch order, so a long archive is represented across its whole
// span instead of by its most recent videos only.
export function keywordSampleStride(eligibleVideos: number, limit = KEYWORD_SAMPLE_LIMIT): number {
  return Math.max(1, Math.ceil(Math.max(0, eligibleVideos) / Math.max(1, limit)));
}
