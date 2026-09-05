import type { Compute } from './compute.js';
import type { Genre, Profile } from './model.js';

const percent = (value: number) => `${(100 * value).toFixed(1)}%`;
export interface MatchReason {
  genre: Genre;
  text: string;
  leftTags: string[];
  rightTags: string[];
  leftShare: number;
  rightShare: number;
  contribution: number;
  hasGeneratedTags: boolean;
}
export async function compareProfiles(left: Profile, right: Profile, genres: Genre[], compute: Compute) {
  if (left.version !== right.version) throw new Error('Incompatible profile versions');
  const details: { genre: Genre; score: number | null; status: 'ready' | 'provisional' | 'missing'; leftCoverage: number; rightCoverage: number }[] = [];
  const reasons: MatchReason[] = [];
  for (const genre of genres) {
    const a = left.genres[genre], b = right.genres[genre];
    if (!a || !b || a.status === 'insufficient' && !a.clusters.length || b.status === 'insufficient' && !b.clusters.length) {
      details.push({ genre, score: null, status: 'missing', leftCoverage: a?.retainedCoverage ?? 0, rightCoverage: b?.retainedCoverage ?? 0 });
      continue;
    }
    const result = await compute.compare(a, b);
    const provisional = !left.complete || !right.complete || a.status === 'insufficient' || b.status === 'insufficient';
    details.push({ genre, score: result.score, status: provisional ? 'provisional' : 'ready', leftCoverage: a.retainedCoverage, rightCoverage: b.retainedCoverage });
    const best = result.transport.find(pair => pair.contribution > 1e-9);
    if (!best) continue;
    const ca = a.clusters[best.left], cb = b.clusters[best.right];
    const leftTags = ca.tags.slice(0, 3).map(t => t.text), rightTags = cb.tags.slice(0, 3).map(t => t.text);
    const hasGeneratedTags = [...ca.tags, ...cb.tags].some(t => t.generatedCount > 0);
    const basis = genre === 'channel type' ? '已辨識頻道類型的權重' : '保留核心 tag 的權重';
    reasons.push({ genre, leftTags, rightTags, leftShare: ca.share, rightShare: cb.share,
      contribution: best.contribution, hasGeneratedTags,
      text: `${genre}：你的「${leftTags.join('、')}」群占${basis} ${percent(ca.share)}，對方的「${rightTags.join('、')}」群占 ${percent(cb.share)}。這組對應為此類別貢獻 ${(best.contribution * 100).toFixed(1)} 分。${hasGeneratedTags ? '代表 tag 含依影片標題補出的模型標籤。' : ''}`,
    });
  }
  // Never normalize over only the available genres: that would inflate a
  // candidate with missing data. A missing genre makes the total unavailable.
  const score = details.some(d => d.score === null) ? null : details.reduce((sum, d) => sum + d.score!, 0) / genres.length;
  return { score, provisional: details.some(d => d.status !== 'ready'), details, reasons,
    profileVersions: { algorithm: left.version, leftBuiltAt: left.builtAt, rightBuiltAt: right.builtAt } };
}
