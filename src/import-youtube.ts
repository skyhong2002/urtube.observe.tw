import { resolve } from 'node:path';
import { config } from './config.js';
import { Repository } from './data/database.js';
import { parseYoutubeArchiveFile } from './youtube/takeout.js';

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run youtube:import -- /path/to/takeout.zip');
  process.exitCode = 2;
} else {
  const repository = new Repository(config.databasePath);
  try {
    // Read from disk: only the history entries are inflated (src/youtube/zip-file.ts).
    const parsed = await parseYoutubeArchiveFile(resolve(input), config.youtube.privateDataKey, 'takeout', {
      maxArchiveBytes: config.takeout.maxArchiveBytes, maxUncompressedBytes: config.takeout.maxUncompressedBytes,
    });
    const result = repository.ingestYoutubeArchive(parsed);
    console.log(JSON.stringify({ ok: true, ...result, totals: repository.youtubeCounts() }, null, 2));
  } finally {
    repository.close();
  }
}
