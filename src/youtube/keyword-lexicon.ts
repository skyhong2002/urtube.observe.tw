// Versioned, reviewable normalization policy for the keyword pipeline.
//
// Every list here is a *governed* exclusion: adding a term needs a synthetic
// regression fixture in tests/keywords.test.ts proving that real topic words
// in the same language still survive. Bump KEYWORD_LEXICON_VERSION whenever a
// list changes so keyword results carry the policy they were produced with.
//
// Lists hold normalized forms only (NFKC, lower case, no surrounding
// punctuation) — see normalizeKeywordToken in keywords.ts.

export const KEYWORD_LEXICON_VERSION = 1;

// English function words. Deliberately small: the goal is to drop glue, not
// to guess at topics.
const EN_FUNCTION_WORDS = [
  'a', 'about', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'being', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'done',
  'for', 'from', 'get', 'gets', 'getting', 'got', 'had', 'has', 'have', 'he', 'her', 'here',
  'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'like', 'me', 'more',
  'most', 'my', 'new', 'no', 'not', 'now', 'of', 'on', 'one', 'or', 'our', 'out', 'so', 'some',
  'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'to', 'up', 'us', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who',
  'why', 'will', 'with', 'would', 'you', 'your',
];

// English YouTube boilerplate: calls to action, platform vocabulary and
// upload-template words that describe the medium, not the interest.
const EN_PLATFORM_WORDS = [
  'channel', 'channels', 'check', 'clip', 'clips', 'comment', 'comments', 'community',
  'edit', 'edited', 'episode', 'ep', 'featuring', 'feat', 'ft', 'follow', 'full', 'hd',
  'highlights', 'join', 'later', 'link', 'links', 'live', 'livestream', 'member', 'members',
  'membership', 'merch', 'official', 'part', 'playlist', 'premiere', 'reaction', 'reupload',
  'share', 'short', 'shorts', 'sponsor', 'sponsored', 'stream', 'streaming', 'subscribe',
  'subscribed', 'subscribers', 'thank', 'thanks', 'today', 'trailer', 'tutorial', 'update',
  'upload', 'video', 'videos', 'vlog', 'vod', 'watch', 'watching', 'welcome', 'youtube',
  'youtuber', '4k', '1080p', '720p',
];

// Social platforms and contact channels. Bare domains and handles are removed
// before segmentation; these catch the platform names that remain as words.
const PLATFORM_NAMES = [
  'bilibili', 'discord', 'douyin', 'dcard', 'facebook', 'fb', 'gmail', 'ig', 'instagram',
  'kakao', 'kofi', 'ko-fi', 'line', 'linktree', 'messenger', 'naver', 'niconico', 'patreon',
  'pixiv', 'plurk', 'reddit', 'snapchat', 'spotify', 'telegram', 'threads', 'tiktok',
  'twitch', 'twitter', 'vk', 'wechat', 'weibo', 'whatsapp', 'x.com', 'xiaohongshu', 'yt',
];

// Traditional Chinese YouTube boilerplate and glue words.
const ZH_WORDS = [
  '一個', '一起', '一下', '以及', '什麼', '今天', '可以', '如何', '就是', '我們', '我的', '你的',
  '這個', '這些', '那個', '那些', '這裡', '因為', '所以', '但是', '還是', '或是', '還有', '沒有',
  '不是', '自己', '大家', '各位', '影片', '頻道', '訂閱', '加入', '會員', '歡迎', '按讚', '分享',
  '留言', '開啟', '小鈴鐺', '鈴鐺', '通知', '直播', '完整版', '完整', '精華', '精華版', '官方',
  '官網', '合作', '業配', '贊助', '購買', '連結', '網址', '點擊', '點我', '追蹤', '關注', '粉絲',
  '粉專', '社群', '記得', '請', '謝謝', '感謝', '本集', '上集', '下集', '第一集', '最新', '更新',
  '字幕', '中字', '高清', '首播', '重播', '剪輯', '片段', '花絮', '預告', '全集', '合集',
];

// Japanese particles, auxiliaries and conjugation fragments that the
// dictionary segmenter emits as standalone "words". Meaningful nouns are
// kanji/katakana and untouched by this list.
const JA_WORDS = [
  'って', 'した', 'さい', 'くだ', 'ください', 'ってみ', 'ってみた', 'てみた', 'てみる', 'みた',
  'その', 'これ', 'それ', 'あれ', 'この', 'あの', 'して', 'する', 'です', 'ます', 'から', 'まで',
  'こと', 'もの', 'ため', 'よう', 'ない', 'なる', 'いる', 'ある', 'れる', 'られ', 'られる',
  'など', 'また', 'とか', 'だけ', 'でも', 'けど', 'しかし', 'そして', 'ので', 'のに', 'という',
  'ながら', 'について', 'による', 'ちゃんねる', 'チャンネル', '登録', 'チャンネル登録', '高評価',
  '動画', '配信', '生放送', '公式', 'ライブ', '実況', 'コメント', 'フォロー', '概要欄', '最新',
];

export const KEYWORD_STOP_LISTS = {
  en: [...EN_FUNCTION_WORDS, ...EN_PLATFORM_WORDS],
  platform: PLATFORM_NAMES,
  zh: ZH_WORDS,
  ja: JA_WORDS,
} as const;

export const KEYWORD_STOP_SET: ReadonlySet<string> = new Set(
  Object.values(KEYWORD_STOP_LISTS).flat(),
);

// Web TLDs that identify a bare domain such as `example.com` or `play.gg`.
// Kept deliberately narrow so `node.js`, `vue.js` and version numbers stay.
export const BARE_DOMAIN_TLDS = [
  'com', 'net', 'org', 'io', 'gg', 'tv', 'co', 'me', 'ly', 'be', 'app', 'dev', 'ai', 'info',
  'xyz', 'link', 'shop', 'store', 'live', 'page', 'site', 'cc', 'fm', 'to', 'so', 'pro', 'tech',
  'tw', 'jp', 'kr', 'cn', 'hk', 'sg', 'uk', 'de', 'fr', 'es', 'it', 'nl', 'br', 'au', 'ca', 'us',
  'in', 'ru', 'edu', 'gov',
] as const;
