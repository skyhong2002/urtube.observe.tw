// Explain keyword pipeline decisions for a synthetic fixture. Prints the
// policy version and aggregate reason counts; candidate labels are printed
// only with --terms, and only from the fixture you pass in. Never point this
// at a production database export in a shared log. Usage:
//   npx tsx scripts/keyword-explain.ts fixture.json [--terms] [--limit N]
//   npx tsx scripts/keyword-explain.ts --sample [--terms]
// The fixture is a JSON array of { title, description?, tags_json?, channel_id? }.
import { readFileSync } from 'node:fs';
import {
  KEYWORD_DEFAULT_LIMIT,
  KEYWORD_POLICY,
  explainYoutubeKeywords,
  type KeywordSourceRow,
} from '../src/youtube/keywords.js';

const args = process.argv.slice(2);
const showTerms = args.includes('--terms');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || KEYWORD_DEFAULT_LIMIT : KEYWORD_DEFAULT_LIMIT;
const file = args.find((arg) => !arg.startsWith('--') && arg !== String(limit));

const sample: KeywordSourceRow[] = [
  { title: 'Welcome to the channel! Live edited highlights', description: 'contact: creator@gmail.com\nJoin the Discord', tags_json: '["subscribe","tiktok"]', channel_id: 'a' },
  { title: 'Minecraft Memes compilation', description: 'Join the Discord', tags_json: '["minecraft memes"]', channel_id: 'a' },
  { title: 'best #minecraftmemes of the week', description: null, tags_json: '[]', channel_id: 'b' },
  { title: '台灣 登山 路線 訂閱 加入 會員', description: null, tags_json: '["台灣 登山"]', channel_id: 'c' },
  { title: '東京 ラーメン 食べ歩き ってみた', description: null, tags_json: '["東京 ラーメン"]', channel_id: 'd' },
];

let rows: KeywordSourceRow[];
if (args.includes('--sample') || !file) {
  rows = sample;
} else {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Fixture must be a JSON array of rows');
  rows = parsed.map((entry) => {
    const record = entry as Record<string, unknown>;
    return {
      title: String(record.title ?? ''),
      description: typeof record.description === 'string' ? record.description : null,
      tags_json: typeof record.tags_json === 'string'
        ? record.tags_json
        : JSON.stringify(Array.isArray(record.tags) ? record.tags : []),
      channel_id: typeof record.channel_id === 'string' ? record.channel_id : null,
    };
  });
}

const explanation = explainYoutubeKeywords(rows, limit);
const output: Record<string, unknown> = {
  policy: {
    algorithmVersion: explanation.algorithmVersion,
    lexiconVersion: explanation.lexiconVersion,
    sourceWeights: KEYWORD_POLICY.sourceWeights,
    phraseDominance: KEYWORD_POLICY.phraseDominance,
  },
  sampledVideos: explanation.sampledVideos,
  kept: explanation.keywords.length,
  summary: explanation.summary,
};
if (showTerms) {
  output.keywords = explanation.keywords.map(({ term, videos, channels, score, sources, aliases }) =>
    ({ term, videos, channels, score, sources, aliases }));
  output.candidates = explanation.candidates;
}
console.log(JSON.stringify(output, null, 2));
