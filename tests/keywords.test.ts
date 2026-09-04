// Keyword pipeline v2 regression fixtures. Everything here is synthetic;
// no production titles, descriptions or watch events are used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { KEYWORD_LEXICON_VERSION, KEYWORD_STOP_SET } from '../src/youtube/keyword-lexicon.js';
import {
  KEYWORD_ALGORITHM_VERSION,
  KEYWORD_DEFAULT_LIMIT,
  KEYWORD_POLICY,
  KEYWORD_SAMPLE_LIMIT,
  canonicalKeywordKey,
  cleanKeywordText,
  explainYoutubeKeywords,
  extractYoutubeKeywords,
  keywordSampleStride,
  type KeywordSourceRow,
} from '../src/youtube/keywords.js';
import type { YoutubeParsedArchive, YoutubeVideoMetadata } from '../src/youtube/types.js';

function row(
  title: string,
  options: { tags?: string[]; description?: string | null; channel?: string | null } = {},
): KeywordSourceRow {
  return {
    title,
    description: options.description ?? null,
    tags_json: JSON.stringify(options.tags ?? []),
    channel_id: options.channel === undefined ? 'channel-fixture' : options.channel,
  };
}

const terms = (rows: KeywordSourceRow[], limit?: number) =>
  extractYoutubeKeywords(rows, limit).map((keyword) => keyword.term);

test('keyword cleaning strips URLs, bare domains, emails, handles, timecodes and hashtag marks', () => {
  const cleaned = cleanKeywordText(
    'Intro 0:00 setup 12:30 · mail me at hello@example.com or @some_handle · play.example.gg · https://x.com/a www.example.com #minecraft node.js v2.1',
  );
  assert.doesNotMatch(cleaned, /example|gmail|handle|https|www|0:00|12:30|#/u);
  assert.match(cleaned, /minecraft/u);
  // Narrow TLD list keeps runtime/library names and version numbers.
  assert.match(cleaned, /node\.js/u);
  assert.match(cleaned, /v2\.1/u);
});

test('CTA, platform, multilingual glue words and residues never become keywords', () => {
  const rows = [
    row('Welcome to the channel! Live edited highlights', {
      tags: ['thank you for watching', 'subscribe', 'tiktok', 'ig', 'facebook'],
      description: 'contact: creator@gmail.com · tiktok.com/@creator · 加入會員 歡迎訂閱本頻道 · 影片 頻道',
    }),
    row('影片 頻道 訂閱 加入 會員 歡迎 直播 完整版 — 台灣 登山 路線', {
      tags: ['台灣 登山', '訂閱', '加入'],
      description: '訂閱 加入 會員 歡迎',
    }),
    row('って した さい くだ ってみ 東京 ラーメン 食べ歩き', {
      tags: ['東京 ラーメン', 'ってみた'],
    }),
    row('Welcome back: live channel update', { tags: ['live', 'channel', 'edited'] }),
    row('台灣 登山 裝備 心得', { tags: ['台灣 登山'] }),
    row('東京 ラーメン ランキング', { tags: ['東京 ラーメン'] }),
  ];
  const kept = terms(rows);
  const banned = [
    'channel', 'live', '影片', '頻道', '訂閱', '加入', '會員', '歡迎', 'thank', 'watching', 'edited',
    'って', 'した', 'さい', 'くだ', 'ってみ', 'tiktok', 'ig', 'facebook', 'gmail.com', 'gmail', 'com',
    'creator', 'contact',
  ];
  for (const word of banned) assert.ok(!kept.includes(word), `${word} leaked into ${kept.join(', ')}`);
  // Real topics in each script survive the cleanup.
  assert.ok(kept.includes('台灣 登山'), kept.join(', '));
  assert.ok(kept.includes('東京 ラーメン'), kept.join(', '));
  for (const word of banned) {
    if (KEYWORD_STOP_SET.has(word)) continue;
    // Words not in the lexicon must be removed structurally (domains,
    // emails, handles) rather than by luck.
    assert.ok(!kept.includes(word));
  }
});

test('sources are weighted separately and repeated channel descriptions do not dominate', () => {
  const boilerplate = 'Join the Discord and grab merch\nGiveaway every stream: aquarium filters for members';
  const rows = [
    ...Array.from({ length: 12 }, (_, index) =>
      row(`Planted tank build log ${index + 1}`, {
        tags: ['planted tank'],
        description: `${boilerplate}\nToday: ${index % 2 ? 'moss carpet' : 'hardscape'} update`,
        channel: 'channel-aqua',
      }),
    ),
    // One channel repeats "sourdough" only in descriptions; two titles mention "espresso".
    row('Morning routine', { description: 'sourdough starter notes', channel: 'channel-food' }),
    row('Kitchen tour', { description: 'sourdough starter notes', channel: 'channel-food' }),
    row('Espresso dial-in basics', { channel: 'channel-coffee' }),
    row('Espresso grinder comparison', { channel: 'channel-coffee' }),
  ];
  const explanation = explainYoutubeKeywords(rows);
  const kept = explanation.keywords.map((keyword) => keyword.term);
  assert.ok(!kept.includes('giveaway'), kept.join(', '));
  assert.ok(!kept.includes('aquarium filters'), kept.join(', '));
  assert.ok(!kept.includes('merch'));
  assert.ok(explanation.summary['boilerplate-line'] >= 12);
  // Title-sourced "espresso" outranks description-only "sourdough" even
  // though both appear in two videos; description-only needs three videos.
  assert.ok(kept.includes('espresso'));
  assert.ok(!kept.includes('sourdough'));
  assert.ok(!kept.includes('sourdough starter'));
  const espresso = explanation.keywords.find((keyword) => keyword.term === 'espresso')!;
  assert.deepEqual(espresso.sources, { title: 2, tag: 0, description: 0 });
  // The planted-tank niche lives on one channel and still ranks at the top:
  // channel diversity is a penalty, not a gate.
  assert.ok(kept.slice(0, 2).includes('planted tank'), kept.join(', '));
  const planted = explanation.keywords.find((keyword) => keyword.term === 'planted tank')!;
  assert.equal(planted.channels, 1);
  assert.equal(planted.videos, 12);
  const single = KEYWORD_POLICY.channelFactorFloor;
  assert.ok(Math.abs(planted.score - Math.round(12 * single / rows.length * 1000) / 1000) < 1e-9);
});

test('safe format variants merge into one canonical family with aliases', () => {
  assert.equal(canonicalKeywordKey('minecraft memes'), 'minecraftmemes');
  assert.equal(canonicalKeywordKey('minecraft-memes'), 'minecraftmemes');
  const rows = [
    row('Minecraft Memes compilation', { channel: 'a' }),
    row('best #minecraftmemes of the week', { channel: 'b' }),
    row('daily minecraft-memes', { tags: ['minecraft memes'], channel: 'c' }),
    row('Minecraft memes but cursed', { channel: 'd' }),
  ];
  const keywords = extractYoutubeKeywords(rows);
  const family = keywords.filter((keyword) => keyword.key === 'minecraftmemes');
  assert.equal(family.length, 1);
  assert.equal(family[0].term, 'minecraft memes');
  assert.equal(family[0].videos, 4);
  assert.equal(family[0].channels, 4);
  // The hyphenated title splits into the spaced form; the hashtag stays a
  // single concatenated spelling and is recorded as an alias.
  assert.deepEqual(family[0].aliases, ['minecraftmemes']);
  // No separate `minecraftmemes` / `minecraft-memes` entries compete.
  assert.equal(keywords.filter((keyword) => keyword.term.replace(/[\s-]/g, '') === 'minecraftmemes').length, 1);
});

test('a unigram mostly covered by one phrase yields to the phrase, independent phrases keep both', () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, index) => row(`Rust async patterns ${index + 1}`, { channel: `c${index}` })),
    row('Rust ownership explained', { channel: 'c9' }),
    // "minecraft" is broad (10 videos, no single phrase); "minecraft memes"
    // covers only a fraction of it, so both stay.
    ...['survival', 'redstone', 'building', 'speedrun', 'mods', 'seeds', 'farms', 'parkour']
      .map((topic, index) => row(`Minecraft ${topic} guide${index}`, { channel: `m${index}` })),
    row('Minecraft memes 1', { channel: 'm8' }),
    row('Minecraft memes 2', { channel: 'm9' }),
  ];
  const explanation = explainYoutubeKeywords(rows, 50);
  const kept = explanation.keywords.map((keyword) => keyword.term);
  assert.ok(kept.includes('rust async'));
  assert.ok(!kept.includes('rust'), kept.join(', '));
  assert.ok(!kept.includes('async'));
  assert.ok(!kept.includes('patterns'));
  assert.ok(kept.includes('minecraft'));
  assert.ok(kept.includes('minecraft memes'));
  const rust = explanation.candidates.find((candidate) => candidate.key === 'rust');
  assert.equal(rust?.reason, 'dominated-by-phrase');
  assert.equal(rust?.by, 'rustasync');
});

test('Japanese glue is dropped by lexicon and short-kana rule while names survive', () => {
  const rows = [
    row('マインクラフト ゲーム実況 やってみた', { channel: 'j1' }),
    row('マインクラフト 建築 してみた', { channel: 'j2' }),
    row('東京 散歩 について 話します', { channel: 'j3' }),
    row('東京 散歩 vlog', { channel: 'j4' }),
  ];
  const kept = terms(rows);
  assert.ok(kept.includes('マインクラフト'), kept.join(', '));
  assert.ok(kept.includes('東京 散歩'), kept.join(', '));
  for (const glue of ['やっ', 'てみ', 'した', 'して', 'について', 'ます', 'し']) {
    assert.ok(!kept.includes(glue), `${glue} leaked into ${kept.join(', ')}`);
  }
});

test('ranking is independent of input order and shows at most the default limit', () => {
  const rows = Array.from({ length: 60 }, (_, index) =>
    row(`Topic${index % 30} deep dive ${index}`, { tags: [`topic${index % 30}`], channel: `c${index % 7}` }),
  );
  const forward = extractYoutubeKeywords(rows);
  const reversed = extractYoutubeKeywords([...rows].reverse());
  const shuffled = extractYoutubeKeywords([...rows].sort((a, b) => (a.title.length % 3) - (b.title.length % 3)));
  assert.deepEqual(reversed, forward);
  assert.deepEqual(shuffled, forward);
  assert.equal(forward.length, KEYWORD_DEFAULT_LIMIT);
  assert.equal(KEYWORD_DEFAULT_LIMIT, 20);
  const explanation = explainYoutubeKeywords(rows);
  assert.ok(explanation.summary['beyond-limit'] > 0);
  assert.equal(explanation.summary.kept, 20);
  assert.equal(explanation.algorithmVersion, KEYWORD_ALGORITHM_VERSION);
  assert.equal(explanation.lexiconVersion, KEYWORD_LEXICON_VERSION);
});

test('small samples show nothing rather than padding with one-off words', () => {
  const rows = [
    row('One-off alpha', { channel: 'a' }),
    ...Array.from({ length: 11 }, (_, index) => row(`Filler ${index}`, { channel: `f${index}` })),
  ];
  const kept = terms(rows);
  assert.ok(!kept.includes('alpha'));
  assert.ok(!kept.includes('one-off'));
  assert.deepEqual(kept, ['filler']);
  assert.deepEqual(terms([]), []);
});

test('explain summary only carries aggregate reason counts', () => {
  const explanation = explainYoutubeKeywords([row('Secret private title about knitting', { channel: 'k' })]);
  const serialized = JSON.stringify(explanation.summary);
  assert.doesNotMatch(serialized, /secret|private|knitting/i);
  for (const value of Object.values(explanation.summary)) assert.equal(typeof value, 'number');
});

test('sample stride spreads large archives evenly and never exceeds the sample limit', () => {
  assert.equal(keywordSampleStride(0), 1);
  assert.equal(keywordSampleStride(KEYWORD_SAMPLE_LIMIT), 1);
  assert.equal(keywordSampleStride(KEYWORD_SAMPLE_LIMIT + 1), 2);
  assert.equal(keywordSampleStride(9000), 5);
  for (const eligible of [1, 1999, 2000, 2001, 4000, 4001, 35_361, 41_535]) {
    const stride = keywordSampleStride(eligible);
    assert.ok(Math.ceil(eligible / stride) <= KEYWORD_SAMPLE_LIMIT, `eligible ${eligible}`);
  }
});

function watch(id: string, videoId: string, channel: string, watchedAt: string, title: string): YoutubeParsedArchive['watches'][number] {
  return {
    eventId: id,
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelId: `channel-${channel}`,
    channelTitle: `Channel ${channel}`,
    channelUrl: `https://www.youtube.com/channel/channel-${channel}`,
    watchedAt,
    actualWatchedSeconds: 600,
    activityType: 'video',
  };
}

test('dashboard and crystal windows rank keywords identically and report coverage', () => {
  const repository = new Repository(':memory:');
  try {
    const watches = Array.from({ length: 30 }, (_, index) =>
      watch(`e${index}`, `VIDEO${String(index).padStart(6, '0')}`, index % 3 ? 'a' : 'b',
        `2026-07-${String((index % 28) + 1).padStart(2, '0')}T10:00:00Z`,
        index % 2 ? `Gardening tips ${index}` : `Chess openings ${index}`),
    );
    repository.ingestYoutubeArchive({ archiveHash: 'keywords-fixture', source: 'takeout', watches, searches: [] });
    const metadata: YoutubeVideoMetadata[] = watches.slice(0, 10).map((event, index) => ({
      videoId: event.videoId ?? '',
      title: event.title,
      channelId: event.channelId ?? null,
      channelTitle: event.channelTitle ?? null,
      description: 'Join the club\nFollow @someone\nThanks for watching',
      tags: [index % 2 ? 'gardening' : 'chess'],
      thumbnailUrl: '',
      durationSeconds: 900,
      publishedAt: '2026-07-01T00:00:00Z',
      categoryId: '26',
      availability: 'available',
      metadataHash: `hash-${index}`,
    }));
    repository.upsertYoutubeVideoMetadata(metadata, '2026-07-29T00:00:00Z');

    const dashboard = repository.youtubeDashboard('all', new Date('2026-07-29T00:00:00Z'));
    const window = repository.youtubeCrystalWindow(null, null);
    assert.deepEqual(window.keywords, dashboard.keywords);
    assert.deepEqual(dashboard.keywordCoverage, {
      sampledVideos: 30,
      eligibleVideos: 30,
      algorithmVersion: KEYWORD_ALGORITHM_VERSION,
      lexiconVersion: KEYWORD_LEXICON_VERSION,
    });
    assert.deepEqual(window.keywordCoverage, dashboard.keywordCoverage);
    const kept = dashboard.keywords.map((keyword) => keyword.term);
    assert.ok(kept.includes('gardening tips'), kept.join(', '));
    assert.ok(kept.includes('chess openings'), kept.join(', '));
    assert.ok(!kept.some((term) => /join|club|follow|someone|thanks|watching/.test(term)));
    assert.ok(dashboard.keywords.every((keyword) => keyword.channels >= 1));
    assert.ok(dashboard.keywords.length <= KEYWORD_DEFAULT_LIMIT);
  } finally {
    repository.close();
  }
});

test('archives larger than the sample limit are sampled evenly with visible coverage', () => {
  const repository = new Repository(':memory:');
  try {
    const total = KEYWORD_SAMPLE_LIMIT * 2 + 10;
    const watches = Array.from({ length: total }, (_, index) => {
      const day = new Date(Date.UTC(2020, 0, 1) + index * 3_600_000 * 6).toISOString();
      // Older half is about astronomy, newer half about cycling: a
      // recent-only cap would hide astronomy entirely.
      return watch(`e${index}`, `V${String(index).padStart(10, '0')}`, `c${index % 5}`, day,
        index < total / 2 ? `Astronomy night ${index}` : `Cycling climb ${index}`);
    });
    repository.ingestYoutubeArchive({ archiveHash: 'keywords-large', source: 'takeout', watches, searches: [] });
    const dashboard = repository.youtubeDashboard('all', new Date('2026-07-29T00:00:00Z'));
    assert.equal(dashboard.keywordCoverage.eligibleVideos, total);
    assert.ok(dashboard.keywordCoverage.sampledVideos <= KEYWORD_SAMPLE_LIMIT);
    assert.ok(dashboard.keywordCoverage.sampledVideos >= KEYWORD_SAMPLE_LIMIT / 2);
    const kept = dashboard.keywords.map((keyword) => keyword.term);
    assert.ok(kept.includes('astronomy night'), kept.join(', '));
    assert.ok(kept.includes('cycling climb'), kept.join(', '));
    const window = repository.youtubeCrystalWindow(null, null);
    assert.deepEqual(window.keywords, dashboard.keywords);
  } finally {
    repository.close();
  }
});
