import { tokenObserver } from './telemetry.js';
import { PartialClassificationError, ProviderError, type Provider } from './provider.js';
import type { MatchingStore } from './store.js';

// Record operation metadata only. Never persist prompts, responses, keys or tags.
export function observedProvider(provider: Provider, store: MatchingStore): Provider {
  async function observe<T>(kind: string, count: number, call: () => Promise<T>): Promise<T> {
    const id = store.operationStart(kind, count);
    try { const result = await tokenObserver.run(value => store.operationUsage(id, value), call); store.operationEnd(id); return result; }
    catch (error) {
      store.operationEnd(id, error instanceof PartialClassificationError ? 'partial_classification_retry'
        : error instanceof Error && error.name === 'ZodError' ? 'invalid_schema'
        : error instanceof ProviderError ? `http_${error.status}`
        : error instanceof SyntaxError ? 'invalid_json'
        : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'invalid_result_or_processing_error', error instanceof PartialClassificationError ? error.results.filter(Boolean).length : undefined);
      throw error;
    }
  }
  return {
    classify: video => observe('gpt_classification', 1, () => provider.classify(video)),
    ...(provider.classifyBatch ? { classifyBatch: (videos: Parameters<NonNullable<Provider['classifyBatch']>>[0]) =>
      observe('gpt_classification', videos.length, () => provider.classifyBatch!(videos)) } : {}),
    embed: tags => observe('gemini_embedding', tags.length, () => provider.embed(tags)),
    channel: (id, title) => observe('channel_processing', 1, () => provider.channel(id, title)),
  };
}
