// Reproduce the SQL scaling evidence with synthetic data through the
// repository's public API, so the probe keeps working when queries change.
// Run from the repository root:
//   node --import tsx docs/analysis/complexity-probe.mjs
// Only :memory: databases are opened. No HTTP requests are made.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.USERS_DATABASE_PATH = ':memory:';
const { Repository } = await import('../../src/data/database.ts');

const watch = (i, videoId, watchedAt, precision = 'exact') => ({
  eventId: `${precision}-${i}`, videoId, title: 'synthetic', url: `https://www.youtube.com/watch?v=${videoId}`,
  channelId: null, channelTitle: null, channelUrl: null, watchedAt, actualWatchedSeconds: null,
  durationSeconds: 600, activityType: 'video', precision,
});
const hour = (i) => new Date(Date.UTC(2020, 0, 1) + i * 3_600_000).toISOString();
const day = (i) => new Date(Date.UTC(2020, 0, 1, 4) + i * 86_400_000).toISOString();
const median = (samples) => samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
const ms = (value) => Math.round(value * 1000) / 1000;
const audit = { node: process.version, measurements: [] };

for (const mode of ['unique', 'repeat']) {
  for (const n of [250, 500, 1000, 2000]) {
    // Estimated watch time over the whole archive (dashboard aggregate).
    const dashboard = [];
    for (let iteration = 0; iteration < 5; iteration++) {
      const repository = new Repository(':memory:');
      try {
        repository.ingestYoutubeArchive({
          archiveHash: `estimate-${mode}-${n}`, source: 'takeout', searches: [],
          watches: Array.from({ length: n }, (_, i) => watch(i, mode === 'repeat' ? 'AAAAAAAAAA0' : `V${String(i).padStart(10, '0')}`, hour(i))),
        });
        const start = performance.now();
        repository.youtubeDashboard('all');
        dashboard.push(performance.now() - start);
      } finally {
        repository.close();
      }
    }
    // Exact events superseding n existing day placeholders in one import.
    const supersede = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      const repository = new Repository(':memory:');
      try {
        const id = (i) => mode === 'repeat' ? 'AAAAAAAAAA0' : `V${String(i).padStart(10, '0')}`;
        repository.ingestYoutubeArchive({
          archiveHash: `days-${mode}-${n}`, source: 'extension', searches: [],
          watches: Array.from({ length: n }, (_, i) => watch(i, id(i), day(i), 'day')),
        });
        const start = performance.now();
        repository.ingestYoutubeArchive({
          archiveHash: `exact-${mode}-${n}`, source: 'takeout', searches: [],
          watches: Array.from({ length: n }, (_, i) => watch(i, id(i), new Date(Date.parse(day(i)) + 60_000).toISOString())),
        });
        supersede.push(performance.now() - start);
      } finally {
        repository.close();
      }
    }
    audit.measurements.push({
      mode, n,
      dashboardMedianMs: ms(median(dashboard)),
      placeholderSupersedeMedianMs: ms(median(supersede)),
    });
  }
}

console.log(JSON.stringify(audit, null, 2));
