import assert from 'node:assert/strict';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { compareWatchProfiles } from '../src/youtube/comparison.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import { weekdayExposure } from '../src/youtube/weekday-average.js';

test('weekday exposure counts rolling boundaries, Taipei midnight and inactive calendar dates', () => {
  assert.deepEqual(weekdayExposure('2026-08-08T08:00:00Z', '2026-09-05T08:00:00Z'), [4, 4, 4, 4, 4, 4, 4]);
  const midnight = weekdayExposure('2026-09-06T15:00:00Z', '2026-09-06T17:00:00Z');
  assert.equal(midnight[0], 1 / 24);
  assert.equal(midnight[1], 1 / 24);
  assert.equal(midnight.reduce((a, b) => a + b), 2 / 24);
  assert.deepEqual(weekdayExposure('2026-09-07T03:00:00Z', '2026-09-21T03:00:00Z', true), [2, 3, 2, 2, 2, 2, 2]);
  assert.deepEqual(weekdayExposure('2026-09-07T03:00:00Z', '2026-09-07T03:00:00Z', true), [0, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(weekdayExposure(null, null, true), [0, 0, 0, 0, 0, 0, 0]);
  const ninety = weekdayExposure('2026-06-07T08:00:00Z', '2026-09-05T08:00:00Z');
  assert.ok(Math.abs(ninety.reduce((a, b) => a + b) - 90) < 1e-10);
});

test('weekday comparisons average by calendar exposure, retaining zero days, fractions and locked shares', () => {
  const a = new Repository(':memory:');
  const b = new Repository(':memory:');
  const now = new Date('2026-09-22T08:00:00Z');
  const seed = (repo: Repository, dates: string[]) => repo.ingestYoutubeArchive({ archiveHash: dates.join(','), source: 'takeout', searches: [], watches: dates.map((date, i) => ({
    eventId: `event-${i}`, videoId: 'AAAAAAAAAA1', title: 'Video', url: 'https://www.youtube.com/watch?v=AAAAAAAAAA1', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', channelTitle: 'Channel', channelUrl: '', watchedAt: date, actualWatchedSeconds: 3600, activityType: 'video',
  })) });
  try {
    seed(a, ['2026-09-07T03:00:00Z', '2026-09-21T03:00:00Z']);
    seed(b, ['2026-09-21T03:00:00Z']);
    const left = a.youtubeComparisonProfile(MATCHING_TAXONOMY.version, 'all', now);
    const right = b.youtubeComparisonProfile(MATCHING_TAXONOMY.version, 'all', now);
    assert.equal(left.weekdays[0]?.estimatedWatchSeconds, 7200, 'private profile retains raw totals');
    assert.equal(left.weekdayDays[1], 3, 'the inactive middle Monday counts');
    const comparison = compareWatchProfiles(left, right, 'all', { connected: true });
    assert.deepEqual(comparison.weekdays.rows[0], { weekday: 1, watches: { a: 2 / 3, b: 1 }, seconds: { a: 2400, b: 3600 } });
    assert.deepEqual(comparison.weekdays.rows[1].seconds, { a: 0, b: 0 });
    const mirrored = compareWatchProfiles(right, left, 'all', { connected: true });
    assert.deepEqual(mirrored.weekdays.rows[0].seconds, { a: 3600, b: 2400 });
    const locked = compareWatchProfiles(left, right, 'all', { connected: false });
    assert.deepEqual(locked.weekdays.rows[0].seconds, { a: 1, b: 1 });
    assert.equal('weekdayDays' in locked.weekdays, false);
    const rolling = a.youtubeComparisonProfile(MATCHING_TAXONOMY.version, '28d', now);
    const average = compareWatchProfiles(rolling, rolling, '28d', { connected: true });
    assert.equal(average.weekdays.rows[0].watches.a, 0.5);
    assert.equal(average.weekdays.rows[0].seconds.a, 1800);
    const empty = new Repository(':memory:');
    try {
      const profile = empty.youtubeComparisonProfile(MATCHING_TAXONOMY.version, 'all', now);
      const result = compareWatchProfiles(profile, profile, 'all', { connected: true });
      assert.ok(result.weekdays.rows.every(row => row.watches.a === 0 && row.seconds.a === 0));
    } finally { empty.close(); }
  } finally { a.close(); b.close(); }
});
