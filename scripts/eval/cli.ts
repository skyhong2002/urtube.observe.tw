// Evaluation entry point (#92 R17/R18):
//   npm run eval -- matching [--json out.json] [--seed N] [--users-per-community N] [--k 5,10]
//   npm run eval -- funnel   [--json out.json] [--seed N] [--users N]
// Everything runs on synthetic data in memory. The environment below is
// forced before the app is imported so a developer shell can never point the
// runner at real databases, real tokens or model providers.
import { writeFileSync } from 'node:fs';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_PATH: ':memory:',
  USERS_DATABASE_PATH: ':memory:',
  INGEST_TOKEN: 'synthetic-eval-ingest-token-000000000000',
  YOUTUBE_PRIVATE_DATA_KEY: 'synthetic-eval-private-data-key-00000000',
  YOUTUBE_CAPTURE_TOKEN: 'synthetic-eval-capture-token-000000000000',
  PUBLIC_BASE_URL: 'http://localhost:3000',
  MAX_USERS: '1000',
  SIGNUP_ENABLED: 'true',
  AI_CLASSIFICATION_ENABLED: '',
  MATCHING_V3_ENABLED: 'false',
  YOUTUBE_API_KEY: '',
  YOUTUBE_API_KEYS: '',
  GEMINI_API_KEY: '',
  GEMINI_API_KEYS: '',
});

const [command = 'matching', ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 ? rest[index + 1] : undefined;
};
const integer = (name: string) => {
  const value = flag(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer`);
  return parsed;
};
const json = flag('json');

if (command === 'matching') {
  const { loadManifest } = await import('./corpus.js');
  const { generateSyntheticCorpus } = await import('./synthetic-corpus.js');
  const { evaluateCorpus, formatReport } = await import('./matching-eval.js');
  const manifest = loadManifest(new URL('./manifest.json', import.meta.url));
  const entry = manifest.corpora.find((corpus) => corpus.source === 'generator');
  if (!entry || entry.source !== 'generator') throw new Error('Manifest has no generator corpus');
  const seed = integer('seed');
  const usersPerCommunity = integer('users-per-community');
  const customised = seed !== undefined || usersPerCommunity !== undefined;
  const corpus = generateSyntheticCorpus(seed ?? entry.seed, usersPerCommunity ? { usersPerCommunity } : {});
  const ks = flag('k')?.split(',').map(Number).filter((k) => Number.isInteger(k) && k > 0);
  const report = await evaluateCorpus(corpus, { ks: ks?.length ? ks : undefined, expectedSha256: customised ? null : entry.expectedSha256 });
  process.stdout.write(formatReport(report));
  if (json) writeFileSync(json, `${JSON.stringify({ ...report, methods: report.methods.map(({ queries: _q, ...m }) => m) }, null, 2)}\n`);
  if (report.provenance.manifestSha256Match === false) {
    process.stderr.write('Generated corpus digest differs from the manifest; the generator is no longer reproducible.\n');
    process.exitCode = 1;
  }
} else if (command === 'funnel') {
  const { runSyntheticFunnel, formatFunnelReport } = await import('./funnel.js');
  const report = await runSyntheticFunnel({ users: integer('users'), seed: integer('seed') });
  process.stdout.write(formatFunnelReport(report));
  if (json) writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
  if (report.users.some((user) => user.failedAt)) process.exitCode = 1;
} else {
  process.stderr.write('Usage: npm run eval -- matching|funnel [--json path] [--seed N]\n');
  process.exitCode = 2;
}
