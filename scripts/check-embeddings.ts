import { checkEmbeddingCapability } from '../src/youtube/embeddings.js';

try {
  console.log(`Embedding capability verified: ${await checkEmbeddingCapability()}`);
} catch {
  console.error('Embedding capability unavailable: check explicit EMBEDDING_* configuration, connectivity, model and 1024-dimensional float response.');
  process.exitCode = 1;
}
