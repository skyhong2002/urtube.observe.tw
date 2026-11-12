import { html } from './pages.js';
import { contributorSection, contributorScript, contributorStyles } from './landing-contributors.js';
import { landingChannelShelf, landingShelfStyles, landingShelfScript } from './landing-channels.js';
import type { Lang } from './i18n.js';
import type { CommunityStats } from '../youtube/community.js';

// Public example linked from the landing page. It is a real member's public
// dashboard, so copy must never present it as the synthetic sample data shown
// in the screenshots.
const PUBLIC_EXAMPLE_HREF = '/skyhong.tw';

// The route passes one of three states: a dashboard link (signed in), a signup
// link (anonymous, signups open) or nothing (signups closed). The landing page
// relabels the anonymous link so the hero names the actual next step.
function heroAction(primaryAction: string, label: string, closed: string): string {
  if (!primaryAction) return `<span class="lp-primary lp-disabled" aria-disabled="true">${closed}</span>`;
  if (/href="\/signup"/.test(primaryAction)) return `<a class="lp-primary" href="/signup">${label}</a>`;
  return primaryAction;
}

export function landingContent(lang: Lang, primaryAction: string, stats: CommunityStats): string {
  const zh = lang === 'zh';
  // Screenshots and the small HTML sample use synthetic data; public-member
  // links are labelled as real examples. Public launch copy reflects current
  // sharing defaults (new accounts private, discovery off).
  const copy = zh ? {
    eyebrow: '你的 YouTube 觀看回顧',
    title: '你的 YouTube 人生，<br><span class="lp-title-accent">都記得。</span>',
    intro: '把 YouTube 觀看紀錄，變成只屬於你的興趣檔案。回顧喜歡的影片、看懂常看的頻道；想分享時，再決定要公開什麼。',
    cta: '開始建立私人回顧 →',
    closed: '目前暫停開放新註冊',
    closedNote: '既有會員仍可<a href="/signup">登入</a>。',
    secondary: '看看大家在看什麼 ↓',
    reassure: '免費 · Google 登入 · 新帳號預設私人、不開放探索',
    steps: [
      ['使用 Google 登入', '只取得名稱、Email 與頭像，不會存取你的 YouTube 帳號。'],
      ['選擇匯入方式', '桌機 Chrome 擴充功能持續同步，或上傳 Google Takeout 補齊舊紀錄。'],
      ['預覽，再決定分享', '先看自己的回顧。匯入與預覽都不會公開，分享由你開啟。'],
    ],
    stepsLabel: '開始只要三步',
    sampleBadge: '範例資料',
    sampleNote: '畫面為合成範例，人名、頻道與數字皆為虛構。',
    publicLink: '查看公開會員實例 ↗',
    publicAria: '查看公開會員實例：Sky Hong 的公開儀表板（真實公開資料，不是上方的合成範例）',
    shotAlt: 'urtube 儀表板截圖，使用合成範例資料，顯示觀看時數與常看頻道',
    sample: { range: '近 90 天', hours: '觀看時數', videos: '影片', channels: '頻道', top: '常看頻道', topics: '興趣主題', tags: ['料理', '設計', '旅行', '音樂', '科學'], label: '合成範例儀表板' },
    communityKicker: '社群 · 近 90 天',
    communityTitle: '大家最近在看什麼？',
    scope: '近 90 天 · 僅計入公開儀表板成員 · 至少 3 位會員看過才上榜 · 觀看時間為估計值',
    scopeSummary: '統計範圍與計算方式',
    unavailable: '社群統計暫時無法載入，請稍後重新整理。',
    method: '依公開成員近 90 天已匯入的紀錄計算，重複觀看會分別計次，觀看時間為估計值。設定變更後，統計可能稍後更新。',
    updated: '統計更新',
    tourKicker: '產品導覽',
    tourTitle: '登入後，你會看到這些。',
    tourNote: '截圖皆使用合成範例資料。',
    tour: {
      channel: ['頻道探索', '常看的創作者，以及大家的共同喜好。', '開啟這個頻道的公開頁面 ↗', '開啟頻道公開頁面（真實公開統計，截圖為範例資料）'],
      matching: ['興趣配對', '從共同主題，多認識一點彼此。需登入，且需雙方開啟好友探索。', '登入後探索配對 ↗', '前往興趣配對（需登入）'],
    } as Record<string, [string, string, string, string]>,
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
    shotAlt: 'urtube dashboard screenshot with synthetic sample data showing viewing hours and favorite channels',
    sample: { range: 'Last 90 days', hours: 'hours watched', videos: 'videos', channels: 'channels', top: 'Top channels', topics: 'Interests', tags: ['Cooking', 'Design', 'Travel', 'Music', 'Science'], label: 'Synthetic sample dashboard' },
    communityKicker: 'Community · 90 days',
    communityTitle: 'What are people watching?',
    scope: 'Last 90 days · Public dashboard members only · Listed once 3+ members watched · Viewing time is estimated',
    scopeSummary: 'Scope & methodology',
    unavailable: 'Community statistics are unavailable. Please refresh later.',
    method: 'Based on public members’ imported records from the last 90 days. Repeated watches are counted separately and watch time is estimated. Changes to sharing settings may take a little time to appear.',
    updated: 'Statistics updated',
    tourKicker: 'Product tour',
    tourTitle: 'What you get after signing in.',
    tourNote: 'All screenshots use synthetic sample data.',
    tour: {
      channel: ['Channel exploration', 'Favorite creators and shared interests.', 'Open the live channel page ↗', 'Open the channel’s public page (real public statistics; the screenshot uses sample data)'],
      matching: ['Interest matching', 'Get to know people through shared topics. Requires sign-in and friend discovery on both sides.', 'Sign in to explore matching ↗', 'Go to interest matching (sign-in required)'],
    } as Record<string, [string, string, string, string]>,
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
  const sampleChannels: Array<[string, string, string]> = [['Open Lab', '#3d6f86', '15.4h'], ['Sound Room', '#a3424a', '12.8h'], ['Design Notes', '#5b5aa0', '9.6h']];
  const sample = `<div class="lp-sample" role="group" aria-label="${copy.sample.label}"><div class="lp-sample-head"><strong>Alex</strong><span>${copy.sample.range}</span></div><dl class="lp-sample-stats"><div><dt>${copy.sample.hours}</dt><dd>92</dd></div><div><dt>${copy.sample.videos}</dt><dd>380</dd></div><div><dt>${copy.sample.channels}</dt><dd>30</dd></div></dl><p class="lp-sample-label">${copy.sample.top}</p><ol class="lp-sample-channels">${sampleChannels.map(([name, color, hours]) => `<li><i style="background:${color}" aria-hidden="true">${name[0]}</i><span>${name}</span><b>${hours}</b></li>`).join('')}</ol><p class="lp-sample-label">${copy.sample.topics}</p><p class="lp-sample-tags">${copy.sample.tags.map(tag => `<span>${tag}</span>`).join('')}</p></div>`;
  const deviceBar = (label: string) => `<div class="lp-device-bar"><span class="lp-mac-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${label}</span></div>`;
  const tour = [['channel', '/channel/UCRIgIJQWuBJ0Cv_VlU3USNA?range=90d', 1422, 1506], ['matching', '/matches', 1480, 1636]] as const;
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
  .lp-reassure,.lp-closed-note{font-size:13px;margin:14px 0 0}.lp-closed-note a{display:inline-block;padding:4px 0}
  .lp-hero-shot{margin:0;min-width:0}.lp-device{background:#121210;border:1px solid #47403e;border-radius:14px;box-shadow:0 35px 90px -30px #000c;overflow:hidden}
  .lp-device-bar{align-items:center;background:linear-gradient(180deg,#292522,#1b1917);border-bottom:1px solid #39332f;color:#b3aaa2;display:flex;font:12px ui-monospace,monospace;gap:16px;height:38px;padding:0 16px}
  .lp-mac-dots{display:flex;gap:6px}.lp-mac-dots i{background:#ff6058;border-radius:50%;display:block;height:8px;width:8px}.lp-mac-dots i:nth-child(2){background:#ffbd2e}.lp-mac-dots i:nth-child(3){background:#28c840}
  .lp-screen{aspect-ratio:1.12;display:block;overflow:hidden}.lp-screen img{display:block;height:100%;object-fit:cover;object-position:50% 8%;width:100%}
  .lp-shot-caption{align-items:center;display:flex;flex-wrap:wrap;font-size:13px;gap:6px 12px;margin-top:12px}.lp-shot-caption>span:not(.lp-badge){color:var(--muted)}.lp-shot-caption a{display:inline-flex;align-items:center;min-height:32px;font-weight:600}
  .lp-badge{background:rgba(250,178,25,.12);border:1px solid rgba(250,178,25,.4);border-radius:999px;color:#f5c95e;font-size:12px;font-weight:700;padding:2px 9px;white-space:nowrap}
  .lp-sample{display:none;background:var(--surface);border:1px solid var(--line-strong);border-radius:14px;padding:16px}
  .lp-sample-head{align-items:baseline;display:flex;justify-content:space-between}.lp-sample-head strong{font-size:17px}.lp-sample-head span{color:var(--muted);font-size:12px}
  .lp-sample-stats{display:grid;gap:8px;grid-template-columns:repeat(3,1fr);margin:12px 0 4px}.lp-sample-stats div{background:var(--raised);border-radius:10px;display:flex;flex-direction:column-reverse;padding:10px}.lp-sample-stats dd{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:0}.lp-sample-stats dt{color:var(--ink-2);font-size:12px}.lp-sample-stats div:first-child dd{color:var(--accent-text)}
  .lp p.lp-sample-label{color:var(--muted);font-size:12px;font-weight:700;margin:12px 0 6px}
  .lp-sample-channels{display:grid;gap:8px;list-style:none;margin:0;padding:0}.lp-sample-channels li{align-items:center;display:flex;font-size:14px;gap:10px}.lp-sample-channels i{border-radius:50%;color:#fff;display:grid;flex:0 0 28px;font-size:13px;font-style:normal;font-weight:700;height:28px;place-items:center}.lp-sample-channels span{flex:1}.lp-sample-channels b{color:var(--ink-2);font-size:13px;font-variant-numeric:tabular-nums;font-weight:600}
  .lp p.lp-sample-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0}.lp-sample-tags span{background:#2a1919;border:1px solid #6d4141;border-radius:999px;color:#ffaaaa;font-size:13px;padding:3px 10px}
  .lp-steps{counter-reset:lp-step;display:grid;gap:14px;grid-template-columns:repeat(3,minmax(0,1fr));list-style:none;margin:44px 0 0;padding:0}
  .lp-steps li{background:var(--surface);border:1px solid var(--line);border-radius:12px;display:flex;gap:14px;padding:18px}.lp-steps li::before{background:var(--raised);border-radius:50%;color:var(--accent-text);content:counter(lp-step);counter-increment:lp-step;display:grid;flex:0 0 32px;font-weight:700;height:32px;place-items:center}
  .lp-steps strong{display:block;font-size:15px}.lp-steps p{font-size:13px;line-height:1.6;margin:4px 0 0}
  .lp-community-scope{font-size:13px;margin:8px 0 0}
  .lp-more-stats{border-bottom:1px solid var(--line);border-top:1px solid var(--line);margin:18px 0 0;padding:4px 0}.lp-more-stats summary{align-items:center;color:var(--ink-2);cursor:pointer;display:flex;font-size:14px;min-height:44px;width:fit-content}.lp-more-stats summary:hover{color:var(--ink)}.lp-method{font-size:13px;max-width:850px}.lp-updated{color:var(--muted);font-size:12px}
  .lp-empty{background:var(--surface);border:1px dashed var(--line-strong);border-radius:12px;padding:24px}
  .lp-gallery-grid{display:grid;gap:28px;grid-template-columns:1fr 1fr;margin-top:28px}.lp-gallery-window{margin:0;min-width:0}.lp-gallery-image{aspect-ratio:1.2;display:block;overflow:hidden}.lp-gallery-image img{display:block;height:100%;object-fit:cover;object-position:50% 8%;width:100%}
  .lp-gallery-window figcaption{margin-top:14px}.lp-gallery-window figcaption strong{display:block;font-size:17px}.lp-gallery-window figcaption>span{color:var(--ink-2);display:block;font-size:14px;margin-top:4px}.lp-gallery-window figcaption a{align-items:center;display:inline-flex;font-size:14px;font-weight:600;min-height:40px}
  .lp-use-cases{display:grid;gap:16px;grid-template-columns:repeat(3,minmax(0,1fr));list-style:none;margin:26px 0 0;padding:0}.lp-use-cases li{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px}.lp-use-cases .lp-kicker{color:var(--accent-text)}.lp-use-cases h3{font-size:19px;line-height:1.4;margin-top:8px}.lp-use-cases p{font-size:14px;margin:8px 0 0}
  .lp-start-grid{display:grid;gap:48px;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr)}.lp-start .lp-actions{margin-top:22px}
  .lp-faq h3{font-size:17px}.lp-faq details{border-bottom:1px solid var(--line)}.lp-faq details:first-of-type{border-top:1px solid var(--line);margin-top:10px}.lp-faq summary{align-items:center;cursor:pointer;display:flex;font-size:15px;font-weight:600;gap:12px;justify-content:space-between;min-height:52px;padding:8px 0}.lp-faq summary::after{color:var(--muted);content:"+";font-size:20px;font-weight:400}.lp-faq details[open] summary::after{content:"−"}.lp-faq details p{font-size:14px;margin:0 0 14px}.lp-faq .lp-privacy-link{display:inline-flex;align-items:center;font-size:14px;margin-top:10px;min-height:44px}
  .lp-links{display:flex;flex-wrap:wrap;font-size:14px;gap:4px 24px;margin-top:40px}.lp-links a{align-items:center;display:inline-flex;min-height:44px}
  @media(max-width:900px){.lp-hero-grid{gap:36px;grid-template-columns:1fr}.lp-hero-shot{max-width:680px}.lp-start-grid{gap:28px;grid-template-columns:1fr}}
  @media(max-width:750px){
    .lp-hero{padding-top:6px}.lp h1{font-size:clamp(30px,8.4vw,44px);margin-top:12px}.lp-intro{font-size:15px;margin-top:12px}.lp-actions{margin-top:20px}.lp-actions>a,.lp-actions>span{flex:1 1 auto}
    .lp-hero-shot .lp-device{display:none}.lp-sample{display:block}
    .lp-steps{gap:10px;grid-template-columns:1fr;margin-top:28px}.lp-steps li{padding:14px}
    .lp-section{margin-top:48px;padding-top:40px}
    .lp-gallery-grid,.lp-use-cases{grid-template-columns:1fr}.lp-gallery-image{aspect-ratio:1.3}
  }
  @media(prefers-reduced-motion:reduce){.lp-actions>a{transition:none}}
  .site-header{position:sticky;top:0;z-index:100;background:rgba(13,13,12,.96);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
  ${landingShelfStyles}
  ${contributorStyles}
  </style><div class="lp">
  <section class="lp-hero" id="welcome" aria-labelledby="lp-title"><div class="lp-hero-grid"><div class="lp-title-block"><div class="lp-kicker">${copy.eyebrow}</div><h1 id="lp-title">${copy.title}</h1><p class="lp-intro">${copy.intro}</p><div class="lp-actions">${action}<a class="lp-secondary" href="#community">${copy.secondary}</a></div>${closedNote}<p class="lp-reassure">${copy.reassure}</p></div>
  <figure class="lp-hero-shot"><div class="lp-device">${deviceBar('Dashboard / urtube')}<div class="lp-screen"><img src="/landing-assets/dashboard.png" width="1500" height="1520" loading="lazy" decoding="async" alt="${copy.shotAlt}"></div></div>${sample}<figcaption class="lp-shot-caption"><span class="lp-badge">${copy.sampleBadge}</span><span>${copy.sampleNote}</span><a href="${PUBLIC_EXAMPLE_HREF}" aria-label="${copy.publicAria}">${copy.publicLink}</a></figcaption></figure></div>
  <ol class="lp-steps" aria-label="${copy.stepsLabel}">${copy.steps.map(([title, text]) => `<li><div><strong>${title}</strong><p>${text}</p></div></li>`).join('')}</ol></section>
  <section id="community" class="lp-section lp-community" aria-labelledby="lp-community-title"><div class="lp-kicker">${copy.communityKicker}</div><h2 id="lp-community-title">${copy.communityTitle}</h2><p class="lp-community-scope">${copy.scope}</p>
  ${stats.status === 'ready' ? `${landingChannelShelf(stats.topDurationChannels ?? [], 'duration', lang)}${landingChannelShelf(stats.topWatchedChannels ?? [], 'watches', lang)}<details class="lp-more-stats"><summary>${copy.scopeSummary}</summary><p class="lp-method">${copy.method}</p><p class="lp-updated">${copy.updated} <time datetime="${html(stats.generatedAt)}">${html(new Date(stats.generatedAt).toLocaleString(zh ? 'zh-TW' : 'en-US', { timeZone: 'Asia/Taipei', hour12: false }))} (UTC+8)</time></p></details>` : `<p class="lp-empty" role="status">${copy.unavailable}</p>`}</section>
  <section class="lp-section lp-gallery" id="product-screens" aria-labelledby="lp-tour-title"><div class="lp-kicker">${copy.tourKicker}</div><h2 id="lp-tour-title">${copy.tourTitle}</h2><p class="lp-section-note"><span class="lp-badge">${copy.sampleBadge}</span> ${copy.tourNote}</p>
  <div class="lp-gallery-grid">${tour.map(([file, href, width, height]) => {
    const [title, description, linkText, aria] = copy.tour[file];
    return `<figure class="lp-gallery-window"><div class="lp-device">${deviceBar(`${title} / urtube`)}<a class="lp-gallery-image" href="${href}" tabindex="-1" aria-hidden="true"><img src="/landing-assets/${file}.png" width="${width}" height="${height}" loading="lazy" decoding="async" alt=""></a></div><figcaption><strong>${title}</strong><span>${description}</span><a href="${href}" aria-label="${aria}">${linkText}</a></figcaption></figure>`;
  }).join('')}</div></section>
  <section class="lp-section lp-story" id="your-story" aria-labelledby="lp-use-title"><div class="lp-kicker">${copy.useKicker}</div><h2 id="lp-use-title">${copy.useTitle}</h2><ul class="lp-use-cases">${copy.uses.map(([kicker, title, text], index) => `<li><span class="lp-kicker">0${index + 1} / ${kicker}</span><h3>${title}</h3><p>${text}</p></li>`).join('')}</ul></section>
  <section class="lp-section lp-start" id="features" aria-labelledby="lp-start-title"><div class="lp-start-grid"><div><div class="lp-kicker">${copy.startKicker}</div><h2 id="lp-start-title">${copy.startTitle}</h2><div class="lp-actions">${action}</div>${closedNote}<p class="lp-reassure">${copy.reassure}</p></div>
  <div class="lp-faq"><h3>${copy.faqTitle}</h3>${copy.faq.map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}<a class="lp-privacy-link" href="/privacy">${copy.privacy}</a></div></div></section>
  ${contributorSection(stats.profiles ?? [], lang)}
  <div class="lp-links"><a href="https://github.com/skyhong2002/urtube.observe.tw" target="_blank" rel="noopener noreferrer">${copy.github}</a><a href="/privacy">${copy.privacy}</a></div></div>${landingShelfScript}${contributorScript}`;
}
