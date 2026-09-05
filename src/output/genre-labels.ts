import type { Genre } from '../matching-v3/model.js';
import type { Lang } from './i18n.js';

// API enums are stable identifiers; people see natural names in their selected language.
export function genreLabels(lang: Lang): Record<Genre, string> {
  return lang === 'zh' ? {
    Politic: '政治', Music: '音樂', Sport: '運動', Education: '教育',
    'Video gaming': '遊戲', Streaming: '直播', News: '新聞', Podcast: 'Podcast', 'channel type': '其他類別',
  } : {
    Politic: 'Politics', Music: 'Music', Sport: 'Sports', Education: 'Education',
    'Video gaming': 'Gaming', Streaming: 'Streaming', News: 'News', Podcast: 'Podcasts', 'channel type': 'Other interests',
  };
}
