import { config } from '../config.js';
import { createYoutubeApiKeyPool, youtubeApiUsage } from '../youtube/api-keys.js';
import { patchOpsStatus, type MatchingOpsStatus } from '../ops-status.js';
import { UserRegistry } from '../users.js';
import { settings } from './model.js';
import { matchingProvider } from './provider.js';
import { computeClient } from './compute.js';
import { runCycle } from './pipeline.js';
import { observedProvider } from './observability.js';

const s = settings();
if (!s.enabled) throw new Error('Set MATCHING_V3_ENABLED=true to start the matching worker');
if (!s.apiKey || !s.embeddingApiKeys.length || s.computeToken.length < 32) throw new Error('Configure GPT API credentials, GEMINI_API_KEY and MATCHING_V3_COMPUTE_TOKEN');
const registry = new UserRegistry(process.env.USERS_DATABASE_PATH ?? './data/users.sqlite');
const store = registry.matchingV3Store();
// Keep quota-exhausted keys parked across worker cycles. Keys belonging to
// distinct Google Cloud projects can continue the channel queue; keys in one
// project still share that project's daily quota.
const youtubeApiKeyPool = createYoutubeApiKeyPool(config.youtube.apiKeys);
// Channel lookups spend the same YouTube quota as the enrichment worker;
// publish this process's count so /status can report the combined total.
const publishUsage = () => {
  const usage = youtubeApiUsage();
  try {
    patchOpsStatus<MatchingOpsStatus>('matching', { heartbeatAt: new Date().toISOString(),
      youtubeApiRequestsSinceReset: usage.requestsSinceReset, youtubeApiQuotaResetAt: usage.quotaResetAt });
  } catch { console.error('Matching v3 status write failed.'); }
};
store.workerHeartbeat(); publishUsage();
const heartbeat = setInterval(() => { store.workerHeartbeat(); publishUsage(); }, 15000);
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
try {
  do {
    try { await runCycle(registry, s, observedProvider(matchingProvider(s, youtubeApiKeyPool), store), computeClient(s), () => stopping); }
    catch { console.error('Matching v3 cycle failed; will retry.'); }
    if (process.argv.includes('--once') || stopping) break;
    const delay = store.nextWorkDelay();
    // Yield without pausing ready jobs. Only poll when no work is eligible.
    if (delay === 0) await new Promise<void>(resolve => setImmediate(resolve));
    else await new Promise(resolve => setTimeout(resolve, delay));
  } while (!stopping);
} finally { clearInterval(heartbeat); registry.close(); }
