import { config } from './config.js';
import type { Repository } from './data/database.js';
import { UserRegistry, DEFAULT_HANDLE, type User } from './users.js';
import { classifyYoutubeVideos } from './youtube/ai.js';
import { enrichYoutubeChannelMetadata, enrichYoutubeMetadata } from './youtube/metadata.js';
import { runYoutubePortabilityStep } from './youtube/portability.js';

type YoutubePortabilityResult = Awaited<ReturnType<typeof runYoutubePortabilityStep>>;

export interface YoutubeWorkerSteps {
  portability(repository: Repository, user: User): Promise<YoutubePortabilityResult>;
  metadata(repository: Repository, user: User): Promise<number>;
  channelMetadata(repository: Repository, user: User): Promise<number>;
  classification(repository: Repository, user: User): Promise<number>;
}

export interface YoutubeWorkerUserResult {
  user: string;
  portability?: YoutubePortabilityResult | 'not_applicable';
  metadata?: number;
  channelMetadata?: number;
  classified?: number;
  error?: string;
}

const defaultSteps: YoutubeWorkerSteps = {
  portability: (repository) => runYoutubePortabilityStep(repository),
  // A fresh history import can contain tens of thousands of videos. The
  // repository caps both calls at 5,000, which is only 100 batched YouTube
  // API requests and prevents a new account from waiting days for enrichment.
  metadata: (repository) => enrichYoutubeMetadata(repository, 5000),
  channelMetadata: (repository) => enrichYoutubeChannelMetadata(repository, 5000),
  // A deep extension backfill can also contain tens of thousands of videos.
  // Recency ordering makes the current dashboard useful first; a larger
  // cycle keeps new extension-only accounts from waiting days for analysis.
  classification: (repository) => classifyYoutubeVideos(repository, 1000),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

// Data Portability remains tied to the instance owner's Google OAuth grant.
// Public metadata enrichment and AI classification, however, belong to each
// user's independent archive and must sweep every per-user database.
export async function runYoutubeWorkerCycle(
  registry: UserRegistry,
  steps: YoutubeWorkerSteps = defaultSteps,
): Promise<YoutubeWorkerUserResult[]> {
  const results: YoutubeWorkerUserResult[] = [];
  for (const user of registry.listUsers()) {
    const repository = registry.repositoryFor(user);
    try {
      const portability = user.handle === DEFAULT_HANDLE
        ? await steps.portability(repository, user)
        : 'not_applicable';
      const metadata = await steps.metadata(repository, user);
      const channelMetadata = await steps.channelMetadata(repository, user);
      const classified = await steps.classification(repository, user);
      repository.setYoutubeSyncState('last_error', '');
      results.push({
        user: user.handle,
        portability,
        metadata,
        channelMetadata,
        classified,
      });
    } catch (error) {
      const message = errorMessage(error);
      repository.setYoutubeSyncState('last_error', message.slice(0, 2000));
      results.push({ user: user.handle, error: message });
    }
  }
  return results;
}

if (process.env.NODE_ENV !== 'test') {
  const registry = new UserRegistry(process.env.USERS_DATABASE_PATH ?? './data/users.sqlite');
  if (config.youtube.captureToken || config.ingestToken) registry.ensureDefaultUser();
  let running = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const users = await runYoutubeWorkerCycle(registry);
      console.log(JSON.stringify({ at: new Date().toISOString(), users }));
      for (const result of users) {
        if (result.error) console.error(`[${result.user}] ${result.error}`);
      }
    } catch (error) {
      console.error(errorMessage(error));
    } finally {
      running = false;
    }
  };

  void run();
  const interval = setInterval(run, 60 * 60_000);
  process.once('SIGTERM', () => {
    clearInterval(interval);
    registry.close();
    process.exit(0);
  });
}
