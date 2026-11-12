import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { messages, PRIVACY_UPDATED } from '../src/output/i18n.js';
import { UserRegistry } from '../src/users.js';

test('privacy policy shares one revision date and summary across languages', () => {
  assert.equal(PRIVACY_UPDATED, '2026-11-13');
  const en = messages('en');
  const zh = messages('zh');
  assert.ok(en.privacyIntro.includes(`Last updated: ${PRIVACY_UPDATED}.`));
  assert.ok(zh.privacyIntro.includes(`最後更新：${PRIVACY_UPDATED}。`));
  assert.match(en.privacyIntro, /This revision adds/);
  assert.match(zh.privacyIntro, /本次修訂新增/);
  for (const t of [en, zh]) assert.doesNotMatch(t.privacyIntro, /2026-09-28/);
  assert.match(en.privacyIntro, /recent-import band/);
  assert.match(zh.privacyIntro, /近 7 天匯入比例/);
  assert.equal(en.privacySections.length, zh.privacySections.length);
});

test('privacy policy separates discovery rankings from public-dashboard home rankings', () => {
  const section = (lang: 'en' | 'zh', heading: RegExp) => messages(lang).privacySections.find(([title]) => heading.test(title))?.[1] ?? '';
  const en = section('en', /^Friend discovery/);
  assert.match(en, /channel page and discovery rankings/);
  assert.match(en, /home page channel rankings, which count public dashboards: to leave those, make your dashboard private/);
  const zh = section('zh', /^好友探索/);
  assert.match(zh, /頻道頁與探索相關排行/);
  assert.match(zh, /要退出首頁頻道排行，請把儀表板設為不公開/);
});

test('privacy policy discloses the blocked edge analytics script and YouTube image requests', () => {
  const en = messages('en').privacySections.find(([title]) => title === 'Images and scripts from other services')?.[1] ?? '';
  const zh = messages('zh').privacySections.find(([title]) => title === '其他服務的圖片與腳本')?.[1] ?? '';
  for (const phrase of [/does not use analytics or advertising trackers/, /Cloudflare/, /Content Security Policy blocks that script/, /home page channel rankings/, /i\.ytimg\.com/, /yt3\.ggpht\.com/, /IP address/, /not the page you are viewing/]) assert.match(en, phrase);
  for (const phrase of [/不使用分析或廣告追蹤工具/, /Cloudflare/, /內容安全政策（CSP）會封鎖這個腳本/, /首頁頻道排行/, /i\.ytimg\.com/, /yt3\.ggpht\.com/, /IP 位址/, /不包含你正在瀏覽的頁面/]) assert.match(zh, phrase);
  assert.match(messages('en').privacyIntro, /images and scripts from other services/);
  assert.match(messages('zh').privacyIntro, /「其他服務的圖片與腳本」/);
});

// The policy's "blocked, so it does not run" relies on this header. Loosening
// script-src or connect-src needs a matching policy update.
test('the CSP the privacy policy relies on blocks third-party scripts and beacons', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const response = await createApp(registry).request('/privacy');
    const directives = (response.headers.get('content-security-policy') ?? '').split(';').map(part => part.trim());
    assert.ok(directives.includes("script-src 'self' 'unsafe-inline'"), directives.join('; '));
    assert.ok(directives.includes("connect-src 'self'"), directives.join('; '));
  } finally {
    registry.close();
  }
});

test('privacy policy states retention and deletion scope without promising backup purges', () => {
  const en = messages('en').privacySections.find(([title]) => title === 'Data retention and deletion')?.[1] ?? '';
  const zh = messages('zh').privacySections.find(([title]) => title === '資料保留與刪除')?.[1] ?? '';
  for (const phrase of [/no[t]? .*expiry date/, /immediately removes your account and sign-in sessions/, /separate viewing-history database/, /does not remove copies already in those backups/, /backup retention period/]) assert.match(en, phrase);
  for (const phrase of [/不會替你匯入的紀錄設定到期日/, /立即移除帳號與登入工作階段/, /獨立的觀看紀錄資料庫/, /不會移除已存在備份中的副本/, /備份保留期限/]) assert.match(zh, phrase);
  // Backup retention is host-configured (BACKUP_RETENTION_DAYS); the policy
  // states the value verified on the production backup service on 2026-11-12.
  // Update both the copy and this test if that setting changes.
  assert.match(en, /backup retention period, currently 3 days/);
  assert.match(zh, /備份保留期限（目前為 3 天）/);
});

test('privacy policy describes the recent-import band, its threshold and the temporary Takeout file', () => {
  const section = (lang: 'en' | 'zh', title: string) => messages(lang).privacySections.find(([heading]) => heading === title)?.[1] ?? '';
  const en = section('en', 'Home page channel rankings');
  for (const phrase of [/last 7 days/, /only as a band/, /under a quarter/, /three quarters or more/, /never as a count or anyone's import time/, /fewer than three members/]) assert.match(en, phrase);
  const zh = section('zh', '首頁頻道排行');
  for (const phrase of [/近 7 天/, /只以分級呈現/, /未滿 1\/4/, /3\/4 以上/, /不顯示人數或任何人的匯入時間/, /少於三位時不顯示/]) assert.match(zh, phrase);
  assert.match(section('en', 'Data retention and deletion'), /deleted as soon as the import finishes or fails/);
  assert.match(section('zh', '資料保留與刪除'), /匯入完成或失敗後立即刪除/);
});
