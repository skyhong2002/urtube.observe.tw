import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createFullBackup } from '../scripts/backup.js';
import { restoreFullBackup } from '../scripts/restore-backup.js';
import { Repository } from '../src/data/database.js';
import { UserRegistry } from '../src/users.js';
import { classifyYoutubeVideosForMatching } from '../src/youtube/matching.js';
import { buildYoutubeCrystal } from '../src/youtube/crystal.js';
import { registryMatchingCrystal } from '../src/youtube/registry-crystal.js';

const SECRET = process.env.YOUTUBE_PRIVATE_DATA_KEY!;

function rowCount(path: string, table: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Number((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
  } finally {
    db.close();
  }
}

test('full backup and restore cover registry, owner, and every materialized user database', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-full-backup-'));
  const source = join(root, 'source');
  const registryPath = join(source, 'users.sqlite');
  const ownerPath = join(source, 'urtube.sqlite');
  const userDataDir = join(source, 'users');
  const bundle = join(root, 'bundle');
  const restoreTarget = join(root, 'restored');
  const registry = new UserRegistry(registryPath, userDataDir);
  try {
    registry.ensureDefaultUser();
    const alice = registry.createUser('alice', 'Alice');
    const aliceRepository = registry.repositoryFor(alice);
    aliceRepository.setYoutubeSyncState('fixture', 'alice-data');
    aliceRepository.upsertYoutubeVideoMetadata([{
      videoId: 'BACKUPMATCH', title: 'Anonymous fixture', channelId: null, channelTitle: null,
      description: '', tags: [], thumbnailUrl: '', durationSeconds: 60,
      publishedAt: null, categoryId: '27', availability: 'available', metadataHash: 'v1',
    }]);
    assert.equal(classifyYoutubeVideosForMatching(aliceRepository), 1);
    registry.setMatchingOptIn(alice.handle, true);
    registry.upsertMatchingCrystal(
      alice,
      registryMatchingCrystal(buildYoutubeCrystal(aliceRepository, alice)),
    );
    new Repository(ownerPath).close();
  } finally {
    registry.close();
  }

  try {
    const manifest = createFullBackup({
      registryPath,
      databasePath: ownerPath,
      dataDir: userDataDir,
      outputDir: bundle,
      ownerHandle: 'sky',
      privateDataKey: SECRET,
    });
    assert.deepEqual(manifest.users, ['sky', 'alice']);
    assert.deepEqual(manifest.files.map(({ target }) => target).sort(), [
      'urtube.sqlite', 'users.sqlite', 'users/alice.sqlite',
    ]);
    assert.ok(manifest.files.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)));
    assert.ok(!readFileSync(join(bundle, 'manifest.json'), 'utf8').includes(SECRET));

    assert.throws(
      () => restoreFullBackup(bundle, restoreTarget, 'wrong-private-data-key-value-123456'),
      /does not match/,
    );
    const restored = restoreFullBackup(bundle, restoreTarget, SECRET);
    assert.equal(restored.ok, true);
    assert.ok(existsSync(join(restoreTarget, 'users.sqlite')));
    assert.ok(existsSync(join(restoreTarget, 'urtube.sqlite')));
    assert.ok(existsSync(join(restoreTarget, 'users', 'alice.sqlite')));
    assert.equal(rowCount(join(restoreTarget, 'users.sqlite'), 'users'), 2);
    assert.equal(rowCount(join(restoreTarget, 'users.sqlite'), 'matching_profiles'), 1);
    assert.equal(rowCount(join(restoreTarget, 'users.sqlite'), 'crystals'), 1);
    assert.equal(rowCount(join(restoreTarget, 'users', 'alice.sqlite'), 'youtube_sync_state'), 1);
    assert.equal(rowCount(join(restoreTarget, 'users', 'alice.sqlite'), 'youtube_video_matching_topics'), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
