import type { YoutubeTopicTrendMonth } from './types.js';
export const INTEREST_HALF_LIFE_DAYS = 90;
export interface TopicDay { day: string; slug: string; seconds: number }

// Warm up from all dated history, then sample at the selected period ends.
// Decaying both numerator and denominator carries the mix through quiet periods.
export function applyTopicDecay(frames: YoutubeTopicTrendMonth[], days: TopicDay[]): void {
  const weights = new Map<string, number>();
  const ordered = [...days].sort((a,b) => a.day.localeCompare(b.day));
  let cursor = 0, previous: number | null = null;
  const advance = (day: string) => {
    const at = Date.parse(day);
    if (previous !== null) {
      const decay = 0.5 ** ((at - previous) / 86400000 / INTEREST_HALF_LIFE_DAYS);
      for (const [slug, weight] of weights) weights.set(slug, weight * decay);
    }
    previous = at;
  };
  for (const frame of frames) {
    const end = frame.periodEnd ?? frame.month;
    while (cursor < ordered.length && ordered[cursor].day <= end) {
      const row = ordered[cursor++];
      advance(row.day);
      weights.set(row.slug, (weights.get(row.slug) ?? 0) + row.seconds);
    }
    advance(end);
    const total = [...weights.values()].reduce((sum, value) => sum + value, 0);
    for (const topic of frame.topics) topic.movingAverageShare = total > 0 ? (weights.get(topic.slug) ?? 0) / total : 0;
  }
}
