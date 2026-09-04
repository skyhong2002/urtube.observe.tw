import type { Repository } from '../data/database.js';

export interface MatchingTaxonomyTopic {
  key: string;
  name: string;
  description: string;
}

// Versioned in source control so every archive is classified on the same
// axes. Bump the version and append/migrate keys; never change an existing
// key's meaning in place.
export const MATCHING_TAXONOMY = Object.freeze({
  version: 1,
  topics: Object.freeze([
    { key: 'film-animation', name: 'Film & Animation', description: 'Movies, animation, filmmaking, and visual storytelling.' },
    { key: 'autos-transport', name: 'Autos & Transport', description: 'Cars, motorcycles, transit, and mobility.' },
    { key: 'music', name: 'Music', description: 'Music, performance, production, and listening culture.' },
    { key: 'animals-nature', name: 'Animals & Nature', description: 'Pets, wildlife, and the natural world.' },
    { key: 'sports-fitness', name: 'Sports & Fitness', description: 'Sports, training, movement, and outdoor activity.' },
    { key: 'travel-events', name: 'Travel & Events', description: 'Places, trips, festivals, and live experiences.' },
    { key: 'gaming', name: 'Gaming', description: 'Games, streams, esports, and game culture.' },
    { key: 'lifestyle-vlogs', name: 'Lifestyle & Vlogs', description: 'Everyday life, personal stories, and routines.' },
    { key: 'comedy', name: 'Comedy', description: 'Humor, sketches, stand-up, and playful commentary.' },
    { key: 'entertainment', name: 'Entertainment', description: 'Shows, celebrities, pop culture, and general entertainment.' },
    { key: 'diy-style', name: 'DIY & Style', description: 'Making, home projects, fashion, beauty, and practical crafts.' },
    { key: 'learning', name: 'Learning', description: 'Courses, explainers, study, and skill development.' },
    { key: 'science-technology', name: 'Science & Technology', description: 'Science, engineering, software, and emerging technology.' },
    { key: 'shows-media', name: 'Shows & Media', description: 'Episodic programs, trailers, and produced media.' },
  ] satisfies MatchingTaxonomyTopic[]),
});

const CATEGORY_TOPIC = Object.freeze({
  '1': 'film-animation',
  '2': 'autos-transport',
  '10': 'music',
  '15': 'animals-nature',
  '17': 'sports-fitness',
  '18': 'film-animation',
  '19': 'travel-events',
  '20': 'gaming',
  '21': 'lifestyle-vlogs',
  '22': 'lifestyle-vlogs',
  '23': 'comedy',
  '24': 'entertainment',
  // News & Politics (25) and Nonprofits & Activism (29) are deliberately
  // excluded. Sensitive-interest governance is separate from matching.
  '26': 'diy-style',
  '27': 'learning',
  '28': 'science-technology',
  '30': 'film-animation',
  '31': 'entertainment',
  '32': 'shows-media',
  '33': 'shows-media',
  '34': 'shows-media',
  '35': 'shows-media',
  '36': 'shows-media',
  '37': 'shows-media',
  '38': 'shows-media',
  '39': 'shows-media',
  '40': 'shows-media',
  '41': 'shows-media',
  '42': 'shows-media',
  '43': 'shows-media',
  '44': 'shows-media',
} satisfies Record<string, string>);

const TOPIC_BY_KEY = new Map(MATCHING_TAXONOMY.topics.map((topic) => [topic.key, topic]));

export function matchingTopicForYoutubeCategory(categoryId: string | null): MatchingTaxonomyTopic | null {
  if (!categoryId) return null;
  return TOPIC_BY_KEY.get(CATEGORY_TOPIC[categoryId as keyof typeof CATEGORY_TOPIC] ?? '') ?? null;
}

// This materializes a dedicated result rather than reusing each archive's
// personalized youtube_topics. Rows from older versions remain available
// during a taxonomy migration and are never silently reinterpreted.
export function classifyYoutubeVideosForMatching(repository: Repository, limit = 1000): number {
  const videos = repository.youtubeVideosForMatchingClassification(MATCHING_TAXONOMY.version, limit);
  for (const video of videos) {
    repository.saveYoutubeVideoMatchingTopic({
      videoId: video.videoId,
      taxonomyVersion: MATCHING_TAXONOMY.version,
      topicKey: matchingTopicForYoutubeCategory(video.categoryId)?.key ?? null,
      metadataHash: video.metadataHash,
    });
  }
  return videos.length;
}

export function youtubeMatchingWorkPending(repository: Repository): boolean {
  return repository.youtubeVideosForMatchingClassification(MATCHING_TAXONOMY.version, 1).length > 0;
}

export interface MatchingTopicProfile {
  taxonomyVersion: number;
  coverage: number;
  topics: Array<{
    key: string;
    name: string;
    watches: number;
    estimatedWatchSeconds: number;
    share: number;
  }>;
}

export function matchingTopicProfile(
  repository: Repository,
  start: string | null,
  end: string | null,
): MatchingTopicProfile {
  const window = repository.youtubeMatchingTopicWindow(MATCHING_TAXONOMY.version, start, end);
  return {
    taxonomyVersion: MATCHING_TAXONOMY.version,
    coverage: window.estimatedWatchSeconds > 0
      ? window.classifiedWatchSeconds / window.estimatedWatchSeconds
      : 0,
    topics: window.topics.map((row) => ({
      ...row,
      name: TOPIC_BY_KEY.get(row.key)?.name ?? row.key,
      share: window.estimatedWatchSeconds > 0
        ? row.estimatedWatchSeconds / window.estimatedWatchSeconds
        : window.watchEvents > 0 ? row.watches / window.watchEvents : 0,
    })),
  };
}
