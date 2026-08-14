import { config } from './config.js';
import { Repository } from './data/database.js';
import { classifyYoutubeVideos } from './youtube/ai.js';
import { enrichYoutubeChannelMetadata, enrichYoutubeMetadata } from './youtube/metadata.js';
import { runYoutubePortabilityStep } from './youtube/portability.js';

const repository = new Repository(config.databasePath);
let running = false;

async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const portability = await runYoutubePortabilityStep(repository);
    const metadata = await enrichYoutubeMetadata(repository);
    const channelMetadata = await enrichYoutubeChannelMetadata(repository);
    const classified = await classifyYoutubeVideos(repository);
    repository.setYoutubeSyncState('last_error', '');
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      portability,
      metadata,
      channelMetadata,
      classified,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    repository.setYoutubeSyncState('last_error', message.slice(0, 2000));
    console.error(message);
  } finally {
    running = false;
  }
}

if (process.env.NODE_ENV !== 'test') {
  run();
  setInterval(run, 60 * 60_000);
  process.once('SIGTERM', () => {
    repository.close();
    process.exit(0);
  });
}

export { run };
