import { config } from './config.js';
import { Repository } from './data/database.js';
import { classifyYoutubeVideos, ensureYoutubeTaxonomy } from './youtube/ai.js';

const repository = new Repository(config.databasePath);
try {
  const topics = await ensureYoutubeTaxonomy(repository, true);
  const classified = await classifyYoutubeVideos(repository, 1000);
  console.log(JSON.stringify({ taxonomyVersion: topics[0]?.version ?? null, topics, classified }, null, 2));
} finally {
  repository.close();
}
