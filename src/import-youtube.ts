import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { Repository } from './data/database.js';
import { parseYoutubeArchive } from './youtube/takeout.js';

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run youtube:import -- /path/to/takeout.zip');
  process.exitCode = 2;
} else {
  const repository = new Repository(config.databasePath);
  try {
    const archive = readFileSync(resolve(input));
    const parsed = parseYoutubeArchive(archive, config.youtube.privateDataKey, 'takeout');
    const result = repository.ingestYoutubeArchive(parsed);
    console.log(JSON.stringify({ ok: true, ...result, totals: repository.youtubeCounts() }, null, 2));
  } finally {
    repository.close();
  }
}
