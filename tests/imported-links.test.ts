import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { Repository } from '../src/data/database.js';
import { hrefAttribute } from '../src/output/pages.js';
import { youtubeDashboardPage } from '../src/output/youtube.js';
import { parseYoutubeArchive } from '../src/youtube/takeout.js';

const SECRET = 'test-private-data-key-with-at-least-32-characters';

test('only web URLs become link targets', () => {
  assert.equal(hrefAttribute('https://www.youtube.com/watch?v=abc&t=1'), ' href="https://www.youtube.com/watch?v=abc&amp;t=1"');
  assert.equal(hrefAttribute('http://example.com/'), ' href="http://example.com/"');
  for (const url of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', '/relative', '', null]) {
    assert.equal(hrefAttribute(url), '', String(url));
  }
});

test('imported history with a script URL renders as an inert row on every list', () => {
  const entries = Array.from({ length: 3 }, (_, index) => ({
    header: 'YouTube', title: 'Watched Totally normal video',
    titleUrl: 'javascript:alert(document.domain)',
    time: `2026-07-28T0${index}:00:00Z`, products: ['YouTube'],
    activityControls: ['YouTube watch history'],
  }));
  const archive = zipSync({
    'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify(entries)),
  });
  const repository = new Repository(':memory:');
  try {
    repository.ingestYoutubeArchive(parseYoutubeArchive(archive, SECRET, 'takeout'));
    const data = repository.youtubeDashboard('all');
    assert.ok(data.topVideos.some(video => video.url.startsWith('javascript:')), 'fixture reaches the sink');
    for (const page of ['overview', 'history'] as const) {
      const body = youtubeDashboardPage('Fixture', data, 'duration', { page });
      assert.doesNotMatch(body, /href="\s*javascript:/i, page);
    }
  } finally {
    repository.close();
  }
});
