// Two bounded requests with synthetic public text, never a user database.
import { settings } from '../src/matching-v3/model.js';
import { matchingProvider, ProviderError } from '../src/matching-v3/provider.js';
// docker --env-file preserves quotes unlike Compose's dotenv parser.
for (const key of ['GEMINI_API_KEY', 'AI_BASE_URL', 'AI_API_KEY', 'OPENAI_API_KEY', 'MATCHING_V3_BASE_URL', 'MATCHING_V3_API_KEY']) {
  const value = process.env[key];
  if (value?.startsWith('"') && value.endsWith('"')) process.env[key] = value.slice(1, -1);
}
const s = settings();
const provider = matchingProvider(s, '');
let failed = false;
for (const [name, call] of [
  ['classification', () => provider.classify({ id: 'synthetic', title: 'Badminton footwork training', tags: ['badminton', 'sports'], channelId: null, channelTitle: null })],
  ['embedding', () => provider.embed(['badminton'])],
] as const) {
  try {
    await call();
    console.log(`${name}: OK`);
  } catch (error) {
    failed = true;
    console.log(`${name}: ${error instanceof ProviderError ? `HTTP ${error.status}` : 'request or response validation failed'}`);
  }
}
if (failed) process.exitCode = 1;
