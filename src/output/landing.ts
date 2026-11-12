import { html } from './pages.js';
import { contributorSection, contributorScript, contributorStyles } from './landing-contributors.js';
import { landingChannelShelf, landingShelfStyles, landingShelfScript } from './landing-channels.js';
import { messages, type Lang } from './i18n.js';
import type { CommunityStats, RecentImports } from '../youtube/community.js';

// Public example linked from the landing page. It is a real member's public
// dashboard, so copy must never present it as the synthetic sample data shown
// in the hero and tour previews.
const PUBLIC_EXAMPLE_HREF = '/skyhong.tw';

// The route passes one of three states: a dashboard link (signed in), a signup
// link (anonymous, signups open) or nothing (signups closed). The landing page
// relabels the anonymous link so the hero names the actual next step.
function heroAction(primaryAction: string, label: string, closed: string): string {
  if (!primaryAction) return `<span class="lp-primary lp-disabled" aria-disabled="true">${closed}</span>`;
  if (/href="\/signup"/.test(primaryAction)) return `<a class="lp-primary" href="/signup">${label}</a>`;
  return primaryAction;
}

// Community statistics calculated longer ago than this are flagged as a
// delayed calculation. The provider recomputes every few minutes, so this only
// appears when a recalculation stalls; it says nothing about how recently
// members imported. That is the separate recentImports band, which shows only
// the share of public members with new records (src/youtube/community.ts).
export const COMMUNITY_STALE_MS = 3_600_000;

export function landingContent(lang: Lang, primaryAction: string, stats: CommunityStats, now = Date.now()): string {
  const zh = lang === 'zh';
  const t = messages(lang);
  // The hero sample and tour previews use synthetic data; public-member
  // links are labelled as real examples. Public launch copy reflects current
  // sharing defaults (new accounts private, discovery off).
  const copy = zh ? {
    eyebrow: '你的 YouTube 觀看回顧',
    title: '你的 YouTube 人生，<br><span class="lp-title-accent">都記得。</span>',
    intro: '把 YouTube 觀看紀錄，變成只屬於你的興趣檔案。回顧喜歡的影片、看懂常看的頻道；想分享時，再決定要公開什麼。',
    cta: '開始建立私人回顧 →',
    closed: '目前暫停開放新註冊',
    closedNote: '既有成員仍可<a href="/signup">登入</a>。',
    secondary: '看看大家在看什麼 ↓',
    reassure: '免費 · Google 登入 · 新帳號預設私人、不開放探索',
    prepMethods: '兩種方式怎麼選 →',
    steps: [
      ['使用 Google 登入', '只取得名稱、Email 與頭像，不會存取你的 YouTube 帳號。'],
      ['選擇匯入方式', '桌機 Chrome 擴充功能持續同步，或上傳 Google Takeout 補齊舊紀錄。'],
      ['預覽，再決定分享', '先看自己的回顧。匯入與預覽都不會公開，分享由你開啟。'],
    ],
    stepsLabel: '開始只要三步',
    sampleBadge: '範例資料',
    sampleNote: '畫面為合成範例，人名、頻道與數字皆為虛構。',
    publicLink: '查看公開成員實例 ↗',
    publicAria: '查看公開成員實例：Sky Hong 的公開儀表板（真實公開資料，不是上方的合成範例）',
    sample: { range: '近 90 天', hours: '觀看時數', videos: '影片', channels: '頻道', top: '常看頻道', topics: '興趣主題', tags: ['料理', '設計', '旅行', '音樂', '科學'], label: '合成範例儀表板', device: '儀表板', weekly: '每週觀看時數', weeklyStart: '11 週前', weeklyEnd: '本週', weeklyAria: (values: number[]) => `每週觀看時數長條圖，合成範例，從 11 週前到本週依序為 ${values.join('、')} 小時，最少 ${Math.min(...values)} 小時、最多 ${Math.max(...values)} 小時` },
    communityKicker: '社群 · 近 90 天',
    communityTitle: '大家最近在看什麼？',
    scope: '近 90 天已匯入的紀錄 · 僅計入公開儀表板成員 · 至少 3 位成員看過才上榜 · 觀看時間為估計值',
    scopeSummary: '統計範圍與計算方式',
    unavailable: '社群統計暫時無法載入，請稍後重新整理。',
    method: '依公開成員近 90 天已匯入的紀錄計算，重複觀看會分別計次，觀看時間為估計值。設定變更後，統計可能稍後更新。',
    estimate: '觀看時間怎麼估計：擴充功能有實測時，直接採用實測時間；其他紀錄取影片長度與到下一次觀看或搜尋的間隔中較短者（有播放位置時也會參考）；只有日期的紀錄最多算 10 分鐘；缺少片長或無法判斷何時結束的紀錄算 0。因此估計值可能比實際觀看時間多或少，不同成員的匯入方式也會影響結果。',
    updated: (time: string) => `統計計算於 ${time}，不代表各成員最後匯入時間。`,
    recentImports: {
      label: '近 7 天有新匯入',
      none: '沒有公開成員',
      few: '少數公開成員（未滿 1/4）',
      'about-quarter': '約四分之一公開成員（1/4 至未滿半數）',
      'about-half': '約半數公開成員（半數至未滿 3/4）',
      most: '多數公開成員（3/4 以上）',
      'too-few-members': '成員太少，不顯示',
      note: '只顯示分級，不顯示人數或任何成員的匯入時間。',
    } as Record<RecentImports | 'label' | 'note', string>,
    coverage: '排行與總數涵蓋公開成員各自已匯入的期間；成員不一定持續匯入，因此可能不含最近的觀看。',
    stale: '統計計算延遲',
    staleNote: '統計超過 1 小時沒有重新計算，數字可能落後。這只反映統計的重新計算，不反映成員最後匯入的時間。',
    rounding: '看過的成員少於 5 位時，時數與次數以約略值顯示。',
    channelSignIn: '頻道頁需要登入才能查看。',
    channelSignInLink: '登入後查看頻道 →',
    tourKicker: '產品導覽',
    tourTitle: '登入後，你會看到這些。',
    tourNote: '以下為頁面示意，使用合成範例資料。',
    tour: {
      channel: ['頻道探索', '常看的創作者，以及大家的共同喜好。', '開啟這個頻道的公開頁面 ↗', '開啟頻道公開頁面（真實公開統計，上方示意為範例資料）'],
      matching: ['興趣配對', '從共同主題，多認識一點彼此。需登入，且需雙方開啟好友探索。', '前往興趣配對 →', '前往興趣配對'],
    } as Record<string, [string, string, string, string]>,
    tourSignIn: {
      channel: ['登入後查看頻道頁 →', '登入後查看頻道頁（頻道頁需要登入，先看註冊與匯入說明）'],
      matching: ['登入後探索配對 →', '登入後探索配對（配對需要登入，先看註冊與匯入說明）'],
    } as Record<string, [string, string]>,
    mock: {
      channel: { label: '合成範例：頻道頁示意', subscribers: '≈ 25,000 位訂閱者', stats: [['3', '觀看成員'], ['64', '觀看次數'], ['15.4h', '估計時數']], list: '成員最常看的影片', videos: [['一段旋律，三種編曲 Vol. 4', '3.2h · 13 次'], ['一段旋律，三種編曲 Vol. 3', '3.1h · 13 次'], ['一段旋律，三種編曲 Vol. 2', '3.1h · 13 次']] },
      matching: { label: '合成範例：配對頁示意', you: '你', them: '對方', score: '合拍度', stats: [['觀看次數', '380', '325'], ['估計時數', '92', '78']], list: '共同頻道', listHours: '時數：Alex · Mia', tags: ['音樂', '學習'] },
    },
    useKicker: '可以怎麼用',
    useTitle: '看懂自己，也找到共同點。',
    uses: [
      ['回顧', '最近，又迷上了什麼？', '從觀看時間、常看頻道與興趣主題，回顧注意力去了哪裡。'],
      ['探索', '大家都在看哪個頻道？', '依觀看時間與次數探索公開成員的熱門頻道，發現新的創作者。'],
      ['連結', '原來，我們都喜歡。', '開啟好友探索後，從共同主題認識彼此；隨時可以關閉。'],
    ],
    startKicker: '開始建立',
    startTitle: '讓看過的日常，有個屬於你的地方。',
    faqTitle: '常見問題',
    faq: [
      ['擴充功能和 Google Takeout 要選哪個？', '擴充功能需要桌機版 Chrome，會持續同步新的觀看紀錄；Google Takeout 是一次性上傳 ZIP，可補齊較舊的紀錄與確切觀看時間，但 Google 準備檔案可能需要數小時以上。兩種都可以使用。'],
      ['我的紀錄會被公開嗎？', '不會自動公開。新帳號預設私人、好友探索關閉；匯入資料或預覽分享畫面都不會改變設定。'],
      ['可以匯出或刪除資料嗎？', '可以。在設定中隨時下載 ZIP 匯出，或永久刪除帳號與所有紀錄。'],
    ],
    github: '查看原始碼 ↗', privacy: '資料與隱私 →',
  } : {
    eyebrow: 'Your YouTube, remembered',
    title: 'Your YouTube life,<br><span class="lp-title-accent">remembered.</span>',
    intro: 'Turn your YouTube watch history into a private interest archive. Revisit favorite videos and understand your channels, then decide what, if anything, to share.',
    cta: 'Import my YouTube history →',
    closed: 'New sign-ups are paused',
    closedNote: 'Existing members can still <a href="/signup">sign in</a>.',
    secondary: 'Explore the community ↓',
    reassure: 'Free · Sign in with Google · New accounts start private with discovery off',
    prepMethods: 'Which method to choose →',
    steps: [
      ['Sign in with Google', 'We receive only your name, email and picture, never access to your YouTube account.'],
      ['Choose how to import', 'Sync with the desktop Chrome extension, or upload a Google Takeout archive for older history.'],
      ['Preview, then decide', 'Explore your own recap first. Importing and previewing never publish anything.'],
    ],
    stepsLabel: 'Three steps to start',
    sampleBadge: 'Sample data',
    sampleNote: 'Synthetic example: names, channels and numbers are made up.',
    publicLink: 'See a real public member dashboard ↗',
    publicAria: 'View a public member’s dashboard: Sky Hong’s public page (real public data, not the synthetic sample above)',
    sample: { range: 'Last 90 days', hours: 'hours watched', videos: 'videos', channels: 'channels', top: 'Top channels', topics: 'Interests', tags: ['Cooking', 'Design', 'Travel', 'Music', 'Science'], label: 'Synthetic sample dashboard', device: 'Dashboard', weekly: 'Hours per week', weeklyStart: '11 weeks ago', weeklyEnd: 'This week', weeklyAria: (values: number[]) => `Bar chart of hours watched per week, synthetic sample, from 11 weeks ago to this week: ${values.join(', ')} hours; lowest ${Math.min(...values)}, highest ${Math.max(...values)}` },
    communityKicker: 'Community · 90 days',
    communityTitle: 'What are people watching?',
    scope: 'Imported records from the last 90 days · Public dashboard members only · Listed once 3+ members watched · Viewing time is estimated',
    scopeSummary: 'Scope & methodology',
    unavailable: 'Community statistics are unavailable. Please refresh later.',
    method: 'Based on public members’ imported records from the last 90 days. Repeated watches are counted separately and watch time is estimated. Changes to sharing settings may take a little time to appear.',
    estimate: 'How watch time is estimated: when the browser extension measured a view, that time is used. Otherwise a view counts the shorter of the video’s length and the time until the next view or search (a saved playback position is also considered); views recorded only by date count at most 10 minutes; views with no known length, or no way to tell when they ended, count as zero. Estimates can be higher or lower than the time actually watched, and depend on how each member imported their history.',
    updated: (time: string) => `Statistics calculated ${time}. This is not each member’s last import time.`,
    recentImports: {
      label: 'New imports in the last 7 days',
      none: 'no public members',
      few: 'a few public members (under a quarter)',
      'about-quarter': 'about a quarter of public members (a quarter to under half)',
      'about-half': 'about half of public members (half to under three quarters)',
      most: 'most public members (three quarters or more)',
      'too-few-members': 'too few members to show',
      note: 'Shown as a band only, never a count or any member’s import time.',
    } as Record<RecentImports | 'label' | 'note', string>,
    coverage: 'Rankings and totals cover whatever period each public member has imported. Members do not always keep importing, so recent viewing may be missing.',
    stale: 'Statistics calculation delayed',
    staleNote: 'Statistics have not been recalculated for over an hour, so the numbers may lag behind. This reflects only the recalculation, not when members last imported.',
    rounding: 'Channels watched by fewer than 5 members show rounded hours and views.',
    channelSignIn: 'Channel pages require sign-in.',
    channelSignInLink: 'Sign in to view channels →',
    tourKicker: 'Product tour',
    tourTitle: 'What you get after signing in.',
    tourNote: 'Page previews below use synthetic sample data.',
    tour: {
      channel: ['Channel exploration', 'Favorite creators and shared interests.', 'Open the live channel page ↗', 'Open the channel’s public page (real public statistics; the preview above uses sample data)'],
      matching: ['Interest matching', 'Get to know people through shared topics. Requires sign-in and friend discovery on both sides.', 'Go to interest matching →', 'Go to interest matching'],
    } as Record<string, [string, string, string, string]>,
    tourSignIn: {
      channel: ['Sign in to view channel pages →', 'Sign in to view channel pages (channel pages require sign-in; see the sign-up and import guide first)'],
      matching: ['Sign in to explore matching →', 'Sign in to explore matching (matching requires sign-in; see the sign-up and import guide first)'],
    } as Record<string, [string, string]>,
    mock: {
      channel: { label: 'Synthetic sample: channel page preview', subscribers: '≈ 25,000 subscribers', stats: [['3', 'members'], ['64', 'views'], ['15.4h', 'est. hours']], list: 'Members’ most-watched videos', videos: [['One melody, three arrangements Vol. 4', '3.2h · 13 views'], ['One melody, three arrangements Vol. 3', '3.1h · 13 views'], ['One melody, three arrangements Vol. 2', '3.1h · 13 views']] },
      matching: { label: 'Synthetic sample: matching page preview', you: 'You', them: 'Them', score: 'match', stats: [['Views', '380', '325'], ['Est. hours', '92', '78']], list: 'Shared channels', listHours: 'Hours: Alex · Mia', tags: ['Music', 'Learning'] },
    },
    useKicker: 'What you can do',
    useTitle: 'Understand yourself. Find common ground.',
    uses: [
      ['Revisit', 'What are you into lately?', 'Viewing time, favorite channels and interest topics show where your attention went.'],
      ['Explore', 'Which creators are people watching?', 'Browse public members’ popular channels by time and views and discover new creators.'],
      ['Connect', 'Something we both love.', 'Turn on friend discovery to meet people through shared topics. Turn it off anytime.'],
    ],
    startKicker: 'Get started',
    startTitle: 'Give your watch history a home.',
    faqTitle: 'Questions',
    faq: [
      ['Extension or Google Takeout?', 'The extension needs desktop Chrome and keeps syncing new views. Google Takeout is a one-time ZIP upload that adds older history with exact times, but Google can take hours or longer to prepare it. You can use both.'],
      ['Will my history be public?', 'Not unless you choose to share it. New accounts start private with friend discovery off, and importing or previewing never changes that.'],
      ['Can I export or delete my data?', 'Yes. Download a ZIP export or permanently delete your account and history from Settings at any time.'],
    ],
    github: 'View source code ↗', privacy: 'Data and privacy →',
  };
  const action = heroAction(primaryAction, copy.cta, copy.closed);
  const closedNote = primaryAction ? '' : `<p class="lp-closed-note">${copy.closedNote}</p>`;
  // The route passes a dashboard link only to signed-in viewers.
  const signedIn = Boolean(primaryAction) && !/href="\/signup"/.test(primaryAction);
  // What an import needs, stated before anyone taps the main action (phones
  // cannot run the extension). The full comparison lives on /signup.
  const prep = signedIn ? '' : `<div class="lp-prep"><p>${t.importPrepSummary(`<a class="lp-inline-link" href="https://takeout.google.com/" target="_blank" rel="noopener noreferrer" aria-label="${t.takeoutLinkAria}">${t.takeoutLink}</a>`)}</p><p class="lp-prep-links"><a href="/signup#import-methods">${copy.prepMethods}</a></p></div>`;
  // Synthetic sample, rendered as translated HTML at every width so its text
  // stays readable (no scaled-down screenshot in the hero).
  // One synthetic data set for every preview: Alex's channel hours in the
  // hero are the same hours shown for Alex in the matching preview, and the
  // weekly bars add up to the 92 hours in the hero totals. Twelve weekly
  // bars that end with this week start 11 weeks ago.
  const sampleChannels: Array<[string, string, string, number]> = [['Open Lab', '#3d6f86', '15.4h', 100], ['Sound Room', '#a3424a', '12.8h', 83], ['Design Notes', '#5b5aa0', '9.6h', 62], ['Small Adventures', '#58714a', '7.1h', 46]];
  const alexHours = new Map(sampleChannels.map(([name, , hours]) => [name, hours]));
  const sharedChannels = ([['Open Lab', '11.2h'], ['Design Notes', '14.5h'], ['Small Adventures', '6.3h']] as const).map(([name, mia]) => [name, alexHours.get(name)!, mia] as const);
  const weekly = [6, 4, 7, 9, 5, 8, 11, 7, 6, 9, 11, 9];
  const weeklyMax = 12;
  const sample = `<div class="lp-sample" role="group" aria-label="${copy.sample.label}"><div class="lp-sample-head"><strong>Alex</strong><span>${copy.sample.range}</span></div><dl class="lp-sample-stats"><div><dt>${copy.sample.hours}</dt><dd>92</dd></div><div><dt>${copy.sample.videos}</dt><dd>380</dd></div><div><dt>${copy.sample.channels}</dt><dd>30</dd></div></dl><p class="lp-sample-label">${copy.sample.weekly}</p><div class="lp-sample-chart"><div class="lp-sample-scale" aria-hidden="true">${[10, 5, 0].map(value => `<span style="bottom:${value / weeklyMax * 100}%">${value}${value ? 'h' : ''}</span>`).join('')}</div><div class="lp-sample-bars" role="img" aria-label="${copy.sample.weeklyAria(weekly)}">${weekly.map(value => `<i style="height:${Math.round(value / weeklyMax * 100)}%"></i>`).join('')}</div></div><p class="lp-sample-axis" aria-hidden="true"><span>${copy.sample.weeklyStart}</span><span>${copy.sample.weeklyEnd}</span></p><p class="lp-sample-label">${copy.sample.top}</p><ol class="lp-sample-channels">${sampleChannels.map(([name, color, hours, share]) => `<li><i style="background:${color}" aria-hidden="true">${name[0]}</i><span>${name}<s style="width:${share}%" aria-hidden="true"></s></span><b>${hours}</b></li>`).join('')}</ol><p class="lp-sample-label lp-sample-topics">${copy.sample.topics}</p><p class="lp-sample-tags">${copy.sample.tags.map(tag => `<span>${tag}</span>`).join('')}</p></div>`;
  const deviceBar = (label: string) => `<div class="lp-device-bar"><span class="lp-mac-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${label}</span></div>`;
  const tour = [['channel', '/channel/UCRIgIJQWuBJ0Cv_VlU3USNA?range=90d'], ['matching', '/matches']] as const;
  // Tour previews are translated HTML at every width, so English visitors see
  // English, text stays readable without zooming, and phone and desktop show
  // the same synthetic numbers. (Screenshots only existed in Chinese and had to
  // be shrunk to a third of their size.)
  const mocks: Record<string, string> = {
    channel: `<div class="lp-sample lp-mock" role="group" aria-label="${copy.mock.channel.label}"><div class="lp-mock-head"><i style="background:#a3424a" aria-hidden="true">S</i><div><strong>Sound Room</strong><span>${copy.mock.channel.subscribers}</span></div></div><dl class="lp-sample-stats">${copy.mock.channel.stats.map(([value, label]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl><p class="lp-sample-label">${copy.mock.channel.list}</p><ol class="lp-mock-list">${copy.mock.channel.videos.map(([title, meta]) => `<li><span>${title}</span><b>${meta}</b></li>`).join('')}</ol></div>`,
    matching: `<div class="lp-sample lp-mock" role="group" aria-label="${copy.mock.matching.label}"><div class="lp-mock-pair"><div><i style="background:#a3424a" aria-hidden="true">A</i><strong>Alex</strong><span>${copy.mock.matching.you}</span></div><p class="lp-mock-score"><b>82%</b><span>${copy.mock.matching.score}</span></p><div><i style="background:#3d6f86" aria-hidden="true">M</i><strong>Mia</strong><span>${copy.mock.matching.them}</span></div></div><table class="lp-mock-compare"><tbody>${copy.mock.matching.stats.map(([label, a, b]) => `<tr><td>${a}</td><th scope="row">${label}</th><td>${b}</td></tr>`).join('')}</tbody></table><p class="lp-sample-label lp-mock-list-head"><span>${copy.mock.matching.list}</span><span>${copy.mock.matching.listHours}</span></p><ol class="lp-mock-list">${sharedChannels.map(([name, a, b]) => `<li><span>${name}</span><b>${a} · ${b}</b></li>`).join('')}</ol><p class="lp-sample-tags">${copy.mock.matching.tags.map(tag => `<span>${tag}</span>`).join('')}</p></div>`,
  };
  const generatedAt = `<time datetime="${html(stats.generatedAt)}">${html(new Date(stats.generatedAt).toLocaleString(zh ? 'zh-TW' : 'en-US', { timeZone: 'Asia/Taipei', hour12: false }))} (UTC+8)</time>`;
  const channelNote = signedIn ? '' : `<p class="lp-channel-note">${copy.channelSignIn} <a href="/signup">${copy.channelSignInLink}</a></p>`;
  // Absent (unavailable) bands print nothing; the calculation time stays.
  const recentImports = stats.recentImports && copy.recentImports[stats.recentImports]
    ? `<p class="lp-updated lp-recent-imports" data-band="${html(stats.recentImports)}">${copy.recentImports.label}${zh ? '：' : ': '}<strong>${copy.recentImports[stats.recentImports]}</strong>${zh ? '。' : '.'}${stats.recentImports === 'too-few-members' ? '' : `${zh ? '' : ' '}${copy.recentImports.note}`}</p>` : '';
  // Freshness: the calculation time is all the front end knows. Flag results
  // that are over an hour old (a fallback to the last result) or missing.
  const generatedMs = Date.parse(stats.generatedAt);
  const stale = stats.status !== 'ready' || !Number.isFinite(generatedMs) || now - generatedMs > COMMUNITY_STALE_MS;
  const staleBadge = `<span class="lp-stale-badge">${copy.stale}</span>`;
  const staleNote = stale && stats.status === 'ready' ? `<p class="lp-stale" role="status">${staleBadge} ${copy.staleNote}</p>` : '';
  return `<style>
  .lp{position:relative}
  .lp h1,.lp h2,.lp h3{margin:0}.lp p{color:var(--ink-2);line-height:1.7}
  .lp-kicker{color:var(--muted);font:600 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase}.lp-kicker:lang(zh){font-family:inherit;font-size:13px;letter-spacing:.06em;text-transform:none}
  .lp h2{font-size:clamp(26px,3.2vw,38px);font-weight:680;letter-spacing:-.035em;line-height:1.3;margin-top:10px}
  .lp-section{border-top:1px solid var(--line);margin-top:72px;padding-top:56px}.lp [id]{scroll-margin-top:96px}
  .lp-section-note{font-size:13px;margin:10px 0 0}
  .lp-hero{padding:22px 0 0}.lp-hero-grid{align-items:center;display:grid;gap:56px;grid-template-columns:minmax(0,1fr) minmax(0,1.08fr)}.lp-title-block{min-width:0}
  .lp-title-block>.lp-kicker{align-items:center;display:flex;gap:10px}.lp-title-block>.lp-kicker::before{background:var(--accent-text);content:"";height:2px;width:22px}
  .lp h1{font-size:clamp(32px,4.1vw,54px);font-weight:720;letter-spacing:-.045em;line-height:1.25;margin-top:18px}.lp-title-accent{color:var(--accent-text)}
  .lp-intro{font-size:16px;margin:18px 0 0;max-width:520px}
  .lp-actions{align-items:center;display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}
  .lp-actions>a,.lp-actions>span{align-items:center;border-radius:999px;display:inline-flex;font-size:15px;font-weight:700;justify-content:center;min-height:48px;padding:12px 22px;text-decoration:none;transition:background .18s,border-color .18s}
  .lp-primary{background:var(--accent);border:1px solid var(--accent);color:#fff}.lp-actions a.lp-primary:hover{background:#b02f2f}
  .lp-secondary{border:1px solid var(--line-strong);color:var(--ink)}.lp-actions a.lp-secondary:hover{border-color:var(--ink-2)}
  .lp-actions .lp-disabled{background:var(--raised);border-color:var(--line-strong);color:var(--ink-2);cursor:not-allowed}
  .lp-reassure,.lp-closed-note{font-size:13px;margin:14px 0 0}
  .lp-prep{border-left:2px solid var(--line-strong);margin:16px 0 0;max-width:540px;padding-left:12px}.lp .lp-prep p{font-size:14px;line-height:1.6;margin:0}.lp .lp-prep p.lp-prep-links{display:flex;flex-wrap:wrap;gap:0 18px}.lp-prep-links a{align-items:center;display:inline-flex;font-size:14px;font-weight:600;min-height:44px}.lp-inline-link{font-weight:600;padding-block:5px}.lp-closed-note a{display:inline-block;padding:4px 0}
  .lp-hero-shot{margin:0;min-width:0}.lp-device{background:#121210;border:1px solid #47403e;border-radius:14px;box-shadow:0 35px 90px -30px #000c;overflow:hidden}
  .lp-device-bar{align-items:center;background:linear-gradient(180deg,#292522,#1b1917);border-bottom:1px solid #39332f;color:#b3aaa2;display:flex;font:12px ui-monospace,monospace;gap:16px;height:38px;padding:0 16px}
  .lp-mac-dots{display:flex;gap:6px}.lp-mac-dots i{background:#ff6058;border-radius:50%;display:block;height:8px;width:8px}.lp-mac-dots i:nth-child(2){background:#ffbd2e}.lp-mac-dots i:nth-child(3){background:#28c840}
  .lp-shot-caption{align-items:center;display:flex;flex-wrap:wrap;font-size:13px;gap:6px 12px;margin-top:12px}.lp-shot-caption>span:not(.lp-badge){color:var(--muted)}.lp-shot-caption a{display:inline-flex;align-items:center;min-height:44px;font-weight:600}
  .lp-badge{background:rgba(250,178,25,.12);border:1px solid rgba(250,178,25,.4);border-radius:999px;color:#f5c95e;font-size:12px;font-weight:700;padding:2px 9px;white-space:nowrap}
  .lp-sample{background:var(--surface);border:1px solid var(--line-strong);border-radius:14px;padding:16px}.lp-device .lp-sample{border:0;border-radius:0;padding:20px 22px 22px}
  .lp-sample-head{align-items:baseline;display:flex;justify-content:space-between}.lp-sample-head strong{font-size:17px}.lp-sample-head span{color:var(--muted);font-size:12px}
  .lp-sample-stats{display:grid;gap:8px;grid-template-columns:repeat(3,1fr);margin:12px 0 4px}.lp-sample-stats div{background:var(--raised);border-radius:10px;display:flex;flex-direction:column-reverse;padding:10px}.lp-sample-stats dd{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:0}.lp-sample-stats dt{color:var(--ink-2);font-size:12px}.lp-sample-stats div:first-child dd{color:var(--accent-text)}
  .lp p.lp-sample-label{color:var(--muted);font-size:12px;font-weight:700;margin:12px 0 6px}
  .lp-sample-channels{display:grid;gap:8px;list-style:none;margin:0;padding:0}.lp-sample-channels li{align-items:center;display:flex;font-size:14px;gap:10px}.lp-sample-channels i{border-radius:50%;color:#fff;display:grid;flex:0 0 28px;font-size:13px;font-style:normal;font-weight:700;height:28px;place-items:center}.lp-sample-channels span{flex:1;min-width:0}.lp-sample-channels s{background:var(--raised);border-radius:3px;display:block;height:4px;margin-top:4px;text-decoration:none}.lp-sample-channels b{color:var(--ink-2);font-size:13px;font-variant-numeric:tabular-nums;font-weight:600}
  .lp p.lp-sample-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0}.lp-sample-tags span{background:#2a1919;border:1px solid #6d4141;border-radius:999px;color:#ffaaaa;font-size:13px;padding:3px 10px}
  .lp-sample-chart{display:grid;gap:6px;grid-template-columns:auto 1fr}.lp-sample-scale{color:var(--muted);font-size:12px;line-height:1;min-width:26px;position:relative;text-align:right}.lp-sample-scale span{position:absolute;right:0;transform:translateY(50%)}.lp-sample-scale span:last-child{transform:none}
  .lp-sample-bars{align-items:end;background:linear-gradient(var(--line-strong),var(--line-strong)) 0 16.67%/100% 1px no-repeat,linear-gradient(var(--line),var(--line)) 0 58.33%/100% 1px no-repeat;display:grid;gap:5px;grid-template-columns:repeat(12,1fr);height:64px}.lp-sample-bars i{background:linear-gradient(180deg,#e05a5a,#8f2d2d);border-radius:3px 3px 0 0;display:block}
  .lp p.lp-sample-axis{border-top:1px solid var(--line-strong);color:var(--muted);display:flex;font-size:12px;justify-content:space-between;line-height:1.4;margin:0 0 0 32px;padding-top:3px}
  .lp p.lp-mock-list-head{display:flex;gap:10px;justify-content:space-between}.lp-mock-list-head span+span{font-weight:600}
  .lp-mock-head{align-items:center;display:flex;gap:12px}.lp-mock-head i,.lp-mock-pair i{border-radius:50%;color:#fff;display:grid;flex:0 0 44px;font-size:18px;font-style:normal;font-weight:700;height:44px;place-items:center;width:44px}.lp-mock-head strong{display:block;font-size:18px}.lp-mock-head span{color:var(--muted);font-size:13px}
  .lp-mock-list{display:grid;gap:8px;list-style:none;margin:0;padding:0}.lp-mock-list li{align-items:baseline;border-bottom:1px solid var(--line);display:flex;font-size:14px;gap:10px;justify-content:space-between;padding-bottom:8px}.lp-mock-list b{color:var(--ink-2);flex:0 0 auto;font-size:13px;font-variant-numeric:tabular-nums;font-weight:600}
  .lp-mock-pair{align-items:center;display:grid;gap:8px;grid-template-columns:1fr auto 1fr;text-align:center}.lp-mock-pair>div{display:grid;justify-items:center;gap:2px}.lp-mock-pair strong{font-size:16px}.lp-mock-pair>div span{color:var(--muted);font-size:12px}.lp p.lp-mock-score{background:var(--accent);border-radius:50%;color:#fff;display:grid;height:72px;margin:0;place-content:center;text-align:center;width:72px}.lp-mock-score b{font-size:20px}.lp-mock-score span{color:#fff;font-size:12px}
  .lp-mock-compare{border-collapse:collapse;font-variant-numeric:tabular-nums;margin:14px 0 2px;width:100%}.lp-mock-compare td,.lp-mock-compare th{border-bottom:1px solid var(--line);padding:8px 0}.lp-mock-compare td{font-size:16px;font-weight:700}.lp-mock-compare td:last-child{text-align:right}.lp-mock-compare th{color:var(--ink-2);font-size:12px;font-weight:600;text-align:center}
  .lp-mock .lp-sample-tags{margin-top:12px}
  .lp-channel-note{font-size:14px;margin:10px 0 0}.lp-channel-note a{align-items:center;display:inline-flex;font-weight:600;min-height:44px}
  .lp-steps{counter-reset:lp-step;display:grid;gap:14px;grid-template-columns:repeat(3,minmax(0,1fr));list-style:none;margin:44px 0 0;padding:0}
  .lp-steps li{background:var(--surface);border:1px solid var(--line);border-radius:12px;display:flex;gap:14px;padding:18px}.lp-steps li::before{background:var(--raised);border-radius:50%;color:var(--accent-text);content:counter(lp-step);counter-increment:lp-step;display:grid;flex:0 0 32px;font-weight:700;height:32px;place-items:center}
  .lp-steps strong{display:block;font-size:15px}.lp-steps p{font-size:13px;line-height:1.6;margin:4px 0 0}
  .lp-community-scope{font-size:13px;margin:8px 0 0}
  .lp-more-stats{border-bottom:1px solid var(--line);border-top:1px solid var(--line);margin:18px 0 0;padding:4px 0}.lp-more-stats summary{align-items:center;color:var(--ink-2);cursor:pointer;display:flex;font-size:14px;min-height:44px;width:fit-content}.lp-more-stats summary:hover{color:var(--ink)}.lp-method{font-size:13px;max-width:850px}.lp p.lp-updated,.lp p.lp-coverage{color:var(--muted);font-size:13px;margin:6px 0 0}.lp-recent-imports strong{color:var(--ink-2);font-weight:600}.lp p.lp-stale{color:var(--ink-2);font-size:13px;margin:10px 0 0}.lp-stale-badge{background:rgba(250,178,25,.12);border:1px solid rgba(250,178,25,.4);border-radius:999px;color:#f5c95e;font-size:12px;font-weight:700;padding:2px 9px;white-space:nowrap}
  .lp-empty{background:var(--surface);border:1px dashed var(--line-strong);border-radius:12px;padding:24px}
  .lp-gallery-grid{display:grid;gap:28px;grid-template-columns:1fr 1fr;margin-top:28px}.lp-gallery-window{display:flex;flex-direction:column;margin:0;min-width:0}.lp-gallery-window .lp-device{flex:1}
  .lp-gallery-window figcaption{align-items:flex-start;display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:14px}.lp-gallery-window figcaption>div{flex:1 1 260px}.lp-gallery-window figcaption strong{display:block;font-size:17px}.lp-gallery-window figcaption span{color:var(--ink-2);display:block;font-size:14px;margin-top:4px}.lp-gallery-window figcaption a{align-items:center;display:inline-flex;font-size:14px;font-weight:600;min-height:44px}
  .lp-use-cases{display:grid;gap:16px;grid-template-columns:repeat(3,minmax(0,1fr));list-style:none;margin:26px 0 0;padding:0}.lp-use-cases li{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px}.lp-use-cases .lp-kicker{color:var(--accent-text)}.lp-use-cases h3{font-size:19px;line-height:1.4;margin-top:8px}.lp-use-cases p{font-size:14px;margin:8px 0 0}
  .lp-start-grid{display:grid;gap:48px;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr)}.lp-start .lp-actions{margin-top:22px}
  .lp-faq h3{font-size:17px}.lp-faq details{border-bottom:1px solid var(--line)}.lp-faq details:first-of-type{border-top:1px solid var(--line);margin-top:10px}.lp-faq summary{align-items:center;cursor:pointer;display:flex;font-size:15px;font-weight:600;gap:12px;justify-content:space-between;min-height:52px;padding:8px 0}.lp-faq summary::after{color:var(--muted);content:"+";font-size:20px;font-weight:400}.lp-faq details[open] summary::after{content:"−"}.lp-faq details p{font-size:14px;margin:0 0 14px}.lp-faq .lp-privacy-link{display:inline-flex;align-items:center;font-size:14px;margin-top:10px;min-height:44px}
  .lp-links{display:flex;flex-wrap:wrap;font-size:14px;gap:4px 24px;margin-top:40px}.lp-links a{align-items:center;display:inline-flex;min-height:44px}
  @media(max-width:900px){.lp-hero-grid{gap:36px;grid-template-columns:1fr}.lp-hero-shot{max-width:680px}.lp-start-grid{gap:28px;grid-template-columns:1fr}}
  @media(max-width:750px){
    .lp-hero{padding-top:6px}.lp h1{font-size:clamp(30px,8.4vw,44px);margin-top:12px}.lp-intro{font-size:15px;margin-top:12px}.lp-actions{margin-top:20px}.lp-actions>a,.lp-actions>span{flex:1 1 auto}
    .lp-device .lp-sample{padding:14px 16px 16px}
    /* Phones: the synthetic previews keep their first rows; longer lists and
       the hero's interest tags are desktop detail (the tour shows tags). */
    .lp-hero-shot .lp-sample-channels li:nth-child(n+4),.lp .lp-hero-shot p.lp-sample-topics,.lp .lp-hero-shot p.lp-sample-tags,.lp-mock-list li:nth-child(n+3){display:none}.lp-sample-bars{height:52px}
    .lp-steps{gap:8px;grid-template-columns:1fr;margin-top:24px}.lp-steps li{gap:12px;padding:12px 14px}.lp-steps li::before{flex-basis:28px;height:28px}
    .lp-section{margin-top:36px;padding-top:32px}
    .lp-gallery-grid,.lp-use-cases{grid-template-columns:1fr}.lp-gallery-grid{gap:24px;margin-top:20px}.lp-gallery-window figcaption{margin-top:10px}
    .lp-use-cases{gap:10px;margin-top:20px}.lp-use-cases li{padding:16px}.lp-use-cases h3{font-size:17px;margin-top:6px}.lp-use-cases p{margin-top:6px}
    .lp-links{margin-top:28px}
    /* The header scrolls away on phones instead of covering a sixth of the
       screen; in-page links then need no room for it. */
    .lp [id]{scroll-margin-top:16px}
  }
  @media(prefers-reduced-motion:reduce){.lp-actions>a{transition:none}}
  .site-header{z-index:100;background:rgba(13,13,12,.96);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}@media(min-width:761px){.site-header{position:sticky;top:0}}
  ${landingShelfStyles}
  ${contributorStyles}
  </style><div class="lp">
  <section class="lp-hero" id="welcome" aria-labelledby="lp-title"><div class="lp-hero-grid"><div class="lp-title-block"><div class="lp-kicker">${copy.eyebrow}</div><h1 id="lp-title">${copy.title}</h1><p class="lp-intro">${copy.intro}</p><div class="lp-actions">${action}<a class="lp-secondary" href="#community">${copy.secondary}</a></div>${closedNote}${prep}<p class="lp-reassure">${copy.reassure}</p></div>
  <figure class="lp-hero-shot"><div class="lp-device">${deviceBar(`${copy.sampleBadge} · ${copy.sample.device} / urtube`)}${sample}</div><figcaption class="lp-shot-caption"><span class="lp-badge">${copy.sampleBadge}</span><span>${copy.sampleNote}</span><a href="${PUBLIC_EXAMPLE_HREF}" aria-label="${copy.publicAria}">${copy.publicLink}</a></figcaption></figure></div>
  <ol class="lp-steps" aria-label="${copy.stepsLabel}">${copy.steps.map(([title, text]) => `<li><div><strong>${title}</strong><p>${text}</p></div></li>`).join('')}</ol></section>
  <section id="community" class="lp-section lp-community" aria-labelledby="lp-community-title"><div class="lp-kicker">${copy.communityKicker}</div><h2 id="lp-community-title">${copy.communityTitle}</h2><p class="lp-community-scope">${copy.scope}</p>
  ${stats.status === 'ready' ? `<p class="lp-updated">${copy.updated(generatedAt)}</p>${recentImports}${staleNote}<p class="lp-coverage">${copy.coverage}</p>${channelNote}${landingChannelShelf(stats.topDurationChannels ?? [], 'duration', lang, signedIn)}${landingChannelShelf(stats.topWatchedChannels ?? [], 'watches', lang, signedIn)}<details class="lp-more-stats"><summary>${copy.scopeSummary}</summary><p class="lp-method">${copy.method} ${copy.rounding}</p><p class="lp-method">${copy.estimate}</p></details>` : `<p class="lp-empty" role="status">${staleBadge} ${copy.unavailable}</p>`}</section>
  <section class="lp-section lp-gallery" id="product-screens" aria-labelledby="lp-tour-title"><div class="lp-kicker">${copy.tourKicker}</div><h2 id="lp-tour-title">${copy.tourTitle}</h2><p class="lp-section-note"><span class="lp-badge">${copy.sampleBadge}</span> ${copy.tourNote}</p>
  <div class="lp-gallery-grid">${tour.map(([file, realHref]) => {
    const [title, description, realText, realAria] = copy.tour[file];
    // Channel pages and matching require sign-in; anonymous visitors go to
    // sign-up (which explains the import first), not to a Google redirect.
    const [href, linkText, aria] = signedIn ? [realHref, realText, realAria] : ['/signup', ...copy.tourSignIn[file]];
    return `<figure class="lp-gallery-window"><div class="lp-device">${deviceBar(`${copy.sampleBadge} · ${title} / urtube`)}${mocks[file]}</div><figcaption><div><strong>${title}</strong><span>${description}</span><a href="${href}" aria-label="${aria}">${linkText}</a></div></figcaption></figure>`;
  }).join('')}</div></section>
  <section class="lp-section lp-story" id="your-story" aria-labelledby="lp-use-title"><div class="lp-kicker">${copy.useKicker}</div><h2 id="lp-use-title">${copy.useTitle}</h2><ul class="lp-use-cases">${copy.uses.map(([kicker, title, text], index) => `<li><span class="lp-kicker">0${index + 1} / ${kicker}</span><h3>${title}</h3><p>${text}</p></li>`).join('')}</ul></section>
  <section class="lp-section lp-start" id="features" aria-labelledby="lp-start-title"><div class="lp-start-grid"><div><div class="lp-kicker">${copy.startKicker}</div><h2 id="lp-start-title">${copy.startTitle}</h2><div class="lp-actions">${action}</div>${closedNote}<p class="lp-reassure">${copy.reassure}</p></div>
  <div class="lp-faq"><h3>${copy.faqTitle}</h3>${copy.faq.map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}<a class="lp-privacy-link" href="/privacy">${copy.privacy}</a></div></div></section>
  ${contributorSection(stats.profiles ?? [], lang)}
  <div class="lp-links"><a href="https://github.com/skyhong2002/urtube.observe.tw" target="_blank" rel="noopener noreferrer">${copy.github}</a><a href="/privacy">${copy.privacy}</a></div></div>${landingShelfScript}${contributorScript}`;
}
