import { GENRES, type Genre, type Profile } from '../matching-v3/model.js';
import { genreLabels } from './genre-labels.js';
import { isVisibleKeyword } from './keyword-display.js';

// Presentation only: intersect original source tags within shared categories.
// Similar clusters or generated tags are not evidence of a shared keyword.
export function blendKeywords(left: Profile, right: Profile, selected: Genre[]): string[] {
  const categoryNames = [...GENRES, ...Object.values(genreLabels('zh')), ...Object.values(genreLabels('en'))];
  const shared = new Map<string, { text: string; count: number }>();
  const tagsFor = (profile: Profile, genre: Genre) => {
    const tags = new Map<string, { text: string; count: number }>();
    for (const cluster of profile.genres[genre]?.clusters ?? []) for (const tag of cluster.tags) {
      const text = tag.text.normalize('NFKC').trim().replace(/\s+/gu, ' ');
      const key = text.toLocaleLowerCase('en-US');
      const count = tag.count - tag.generatedCount;
      if (!text || count <= 0 || !isVisibleKeyword(text, categoryNames)) continue;
      if (count > (tags.get(key)?.count ?? 0)) tags.set(key, { text, count });
    }
    return tags;
  };
  for (const genre of selected) {
    const a = tagsFor(left, genre), b = tagsFor(right, genre);
    for (const [key, tag] of a) {
      const other = b.get(key);
      if (!other) continue;
      const count = Math.min(tag.count, other.count);
      if (count > (shared.get(key)?.count ?? 0)) shared.set(key, { text: tag.text, count });
    }
  }
  return [...shared.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, 5).map(tag => tag.text);
}
