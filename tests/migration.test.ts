import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { Repository } from '../src/data/database.js';
import { migrateFromInfovore } from '../scripts/migrate-from-infovore.js';
import { parseYoutubeArchive } from '../src/youtube/takeout.js';

const SECRET = process.env.YOUTUBE_PRIVATE_DATA_KEY!;

function fixtureZip(): Uint8Array {
  return zipSync({
    'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify([
      {
        header: 'YouTube', title: 'Watched Migration Video One',
        titleUrl: 'https://www.youtube.com/watch?v=migratevid1',
        subtitles: [{ name: 'Channel One', url: 'https://www.youtube.com/channel/channel-one' }],
        time: '2026-07-28T01:00:00Z', products: ['YouTube'],
        activityControls: ['YouTube watch history'],
      },
      {
        header: 'YouTube', title: 'Watched Migration Video Two',
        titleUrl: 'https://www.youtube.com/watch?v=migratevid2',
        subtitles: [{ name: 'Channel Two', url: 'https://www.youtube.com/channel/channel-two' }],
        time: '2026-07-28T02:00:00Z', products: ['YouTube'],
        activityControls: ['YouTube watch history'],
      },
    ])),
    'Takeout/YouTube and YouTube Music/history/search-history.json': strToU8(JSON.stringify([{
      header: 'YouTube', title: 'Searched for migration private query',
      time: '2026-07-28T00:30:00Z', products: ['YouTube'],
      activityControls: ['YouTube search history'],
    }])),
  });
}

test('migration copies exactly the YouTube subset and row counts verify', () => {
  const dir = mkdtempSync(join(tmpdir(), 'urtube-migration-'));
  const sourcePath = join(dir, 'infovore-backup.sqlite');
  const targetPath = join(dir, 'urtube.sqlite');
  try {
    // Simulate the Infovore production database: YouTube data plus another
    // platform's activities that must NOT cross the boundary.
    const source = new Repository(sourcePath);
    let expectedCounts;
    try {
      source.ingestYoutubeArchive(parseYoutubeArchive(fixtureZip(), SECRET));
      source.ingestYoutubeProgress({
        scanId: 'scan-migration-123456789',
        observedAt: '2026-07-28T03:00:00.000Z',
        complete: true,
        items: [{ videoId: 'migratevid1', progressPercent: 40, resumeSeconds: 100, durationSeconds: 600 }],
      });
      source.setYoutubeSyncState('checkpoint', '2026-07-28T00:00:00.000Z');
      source.ingestEntries([{
        sourceItemId: 'other-platform-item',
        source: 'goodreads',
        kind: 'book',
        title: 'A Private Book Elsewhere',
        image: '',
        status: 'read',
        activityAt: '2026-07-01',
        rating: null,
        extra: {},
      }]);
      expectedCounts = source.youtubeCounts();
      assert.equal(source.queryActivities({}).total, 1);
    } finally {
      source.close();
    }

    const report = migrateFromInfovore(sourcePath, targetPath);
    assert.equal(report.ok, true);
    for (const entry of report.tables) {
      assert.equal(entry.source, entry.target, `${entry.table} count mismatch`);
    }
    const watchEvents = report.tables.find((entry) => entry.table === 'youtube_watch_events');
    assert.equal(watchEvents?.target, 2);
    const progress = report.tables.find((entry) => entry.table === 'youtube_video_progress');
    assert.equal(progress?.target, 1);

    // The restored database opens with the normal Repository, reports the
    // same counts, and contains no non-YouTube rows.
    const restored = new Repository(targetPath);
    try {
      assert.deepEqual(restored.youtubeCounts(), expectedCounts);
      assert.equal(restored.youtubeSyncState('checkpoint'), '2026-07-28T00:00:00.000Z');
      assert.equal(restored.queryActivities({}).total, 0);
      assert.equal(restored.queryActivities({ source: 'goodreads' }).total, 0);
      // Ingesting the same archive again inserts nothing: idempotency
      // semantics survive the migration.
      const replay = restored.ingestYoutubeArchive(parseYoutubeArchive(fixtureZip(), SECRET));
      assert.equal(replay.watchesInserted, 0);
      assert.equal(replay.searchesInserted, 0);
    } finally {
      restored.close();
    }

    assert.throws(() => migrateFromInfovore(join(dir, 'missing.sqlite'), join(dir, 'x.sqlite')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
