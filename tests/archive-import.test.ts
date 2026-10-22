import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { importArchive } from '../src/archive-import.js';
import { Repository } from '../src/data/database.js';

const SECRET = 'test-private-data-key-with-at-least-32-characters';

function archive(count: number): Uint8Array {
  const entries = Array.from({ length: count }, (_, index) => ({
    header: 'YouTube', title: `Watched Synthetic ${index}`,
    titleUrl: `https://www.youtube.com/watch?v=${String(index).padStart(11, 'A')}`,
    time: new Date(Date.UTC(2025, 0, 1) + index * 60_000).toISOString(),
    products: ['YouTube'], activityControls: ['YouTube watch history'],
  }));
  return zipSync({ 'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify(entries)) });
}

test('file-backed archives import off the request thread', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-archive-import-'));
  const databasePath = join(root, 'user.sqlite');
  const live = new Repository(databasePath);
  try {
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 5);
    const started = Date.now();
    const result = await importArchive(live, { databasePath, archive: archive(20_000), dataKey: SECRET, source: 'takeout' });
    const elapsed = Date.now() - started;
    clearInterval(timer);
    assert.equal(result.watchesInserted, 20_000);
    // The connection this thread already had sees the other thread's writes.
    assert.equal(live.youtubeCounts().watches, 20_000);
    assert.ok(ticks >= Math.min(5, elapsed / 50), `timers kept running: ${ticks} ticks in ${elapsed} ms`);

    await assert.rejects(
      importArchive(live, { databasePath, archive: strToU8('not a zip'), dataKey: SECRET, source: 'takeout' }),
      /./, 'parse errors cross back as rejections',
    );
  } finally {
    live.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('in-memory archives still import through the given repository', async () => {
  const repository = new Repository(':memory:');
  try {
    const result = await importArchive(repository, { databasePath: ':memory:', archive: archive(3), dataKey: SECRET, source: 'takeout' });
    assert.equal(result.watchesInserted, 3);
    assert.equal(repository.youtubeCounts().watches, 3);
  } finally {
    repository.close();
  }
});
