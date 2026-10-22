// Versioned evaluation corpus schema (#92 R17). A corpus holds aggregate,
// per-person interest profiles plus graded relevance judgments. It never holds
// raw watch events, timestamps, searches or real identities.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { CONTENT_GENRES } from '../../src/matching-v3/model.js';
import { MATCHING_TAXONOMY } from '../../src/youtube/matching.js';

export const CORPUS_SCHEMA = 'urtube-eval-corpus' as const;
export const CORPUS_SCHEMA_VERSION = 1 as const;
export const MANIFEST_SCHEMA = 'urtube-eval-manifest' as const;

const share = z.number().finite().min(0).max(1);
const topicKey = z.enum(MATCHING_TAXONOMY.topics.map((topic) => topic.key) as [string, ...string[]]);
const genre = z.enum(CONTENT_GENRES as unknown as [string, ...string[]]);

const windowSchema = z.object({
  watchEvents: z.number().int().min(0),
  activeDays: z.number().int().min(0),
  // Share of watch time classified on the legacy taxonomy (0..1).
  topicCoverage: share,
  channels: z.array(z.object({ key: z.string().min(1), name: z.string().min(1), share })),
  topics: z.array(z.object({ key: topicKey, share })),
  // Tag occurrences with the genre the (simulated or real) classifier assigned.
  tags: z.array(z.object({ text: z.string().min(1), count: z.number().int().min(1), genre })),
}).strict();

const userSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  // Recent = the app's 90-day matching window; prior = the window before it.
  windows: z.object({ recent: windowSchema, prior: windowSchema }).strict(),
  // Optional ground-truth genre labels for genre macro-F1.
  genres: z.array(genre).optional(),
  // Free-form, non-identifying annotations for error analysis (synthetic only).
  annotations: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).strict();

const judgmentSchema = z.object({
  candidateUserId: z.string(),
  // 0 = not relevant, 1 = partially relevant, 2 = clearly relevant.
  grade: z.number().int().min(0).max(2),
  raterId: z.string().min(1).default('planted'),
}).strict();

export const corpusSchema = z.object({
  schema: z.literal(CORPUS_SCHEMA),
  schemaVersion: z.literal(CORPUS_SCHEMA_VERSION),
  corpusId: z.string().min(1),
  corpusVersion: z.string().min(1),
  kind: z.enum(['synthetic', 'consented-labelled']),
  // 'planted' means relevance was produced by the generator, not by people.
  relevanceSource: z.enum(['planted', 'human']),
  relevanceVerified: z.boolean(),
  generator: z.object({ name: z.string(), version: z.string(), seed: z.number().int(), params: z.record(z.string(), z.unknown()) }).nullable(),
  // Synthetic stand-ins for tag embeddings (unit vectors, any fixed dimension).
  tagVectors: z.record(z.string(), z.array(z.number().finite())),
  users: z.array(userSchema).min(2),
  queries: z.array(z.object({ queryUserId: z.string(), judgments: z.array(judgmentSchema).min(1) }).strict()).min(1),
}).strict().superRefine((corpus, ctx) => {
  const ids = new Set(corpus.users.map((user) => user.id));
  if (ids.size !== corpus.users.length) ctx.addIssue({ code: 'custom', message: 'duplicate user id' });
  const dims = new Set(Object.values(corpus.tagVectors).map((vector) => vector.length));
  if (dims.size > 1) ctx.addIssue({ code: 'custom', message: 'tag vectors must share one dimension' });
  for (const query of corpus.queries) {
    if (!ids.has(query.queryUserId)) ctx.addIssue({ code: 'custom', message: `unknown query user ${query.queryUserId}` });
    for (const judgment of query.judgments) {
      if (!ids.has(judgment.candidateUserId) || judgment.candidateUserId === query.queryUserId) {
        ctx.addIssue({ code: 'custom', message: `invalid judgment ${query.queryUserId}->${judgment.candidateUserId}` });
      }
    }
  }
  if (corpus.relevanceSource === 'planted' && corpus.relevanceVerified) {
    ctx.addIssue({ code: 'custom', message: 'planted relevance cannot be marked verified' });
  }
});

export type EvaluationCorpus = z.infer<typeof corpusSchema>;
export type CorpusUser = EvaluationCorpus['users'][number];
export type CorpusWindow = CorpusUser['windows']['recent'];

export const manifestSchema = z.object({
  schema: z.literal(MANIFEST_SCHEMA),
  manifestVersion: z.number().int().min(1),
  corpora: z.array(z.discriminatedUnion('source', [
    z.object({
      id: z.string(), source: z.literal('generator'), corpusVersion: z.string(),
      generator: z.string(), seed: z.number().int(), params: z.record(z.string(), z.unknown()),
      // Digest of the canonical JSON the generator must reproduce.
      expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
      relevanceSource: z.literal('planted'), note: z.string(),
    }).strict(),
    z.object({
      id: z.string(), source: z.literal('file'), corpusVersion: z.string(), path: z.string(),
      expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
      relevanceSource: z.enum(['planted', 'human']),
      // Required for anything that is not synthetic: who consented, to what.
      consent: z.string().min(1), note: z.string(),
    }).strict(),
  ])).min(1),
}).strict();
export type EvaluationManifest = z.infer<typeof manifestSchema>;

// Canonical serialization: stable key order so digests are reproducible.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner) => inner && typeof inner === 'object' && !Array.isArray(inner)
    ? Object.fromEntries(Object.keys(inner).sort().map((key) => [key, inner[key]]))
    : inner);
}

export function corpusDigest(corpus: EvaluationCorpus): string {
  return createHash('sha256').update(canonicalJson(corpus)).digest('hex');
}

export function parseCorpus(value: unknown): EvaluationCorpus {
  return corpusSchema.parse(value);
}

export function loadManifest(path: URL | string): EvaluationManifest {
  return manifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
