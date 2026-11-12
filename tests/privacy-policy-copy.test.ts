import assert from 'node:assert/strict';
import test from 'node:test';
import { messages, PRIVACY_UPDATED } from '../src/output/i18n.js';

test('privacy policy shares one revision date and summary across languages', () => {
  assert.equal(PRIVACY_UPDATED, '2026-11-12');
  const en = messages('en');
  const zh = messages('zh');
  assert.ok(en.privacyIntro.includes(`Last updated: ${PRIVACY_UPDATED}.`));
  assert.ok(zh.privacyIntro.includes(`最後更新：${PRIVACY_UPDATED}。`));
  assert.match(en.privacyIntro, /This revision adds/);
  assert.match(zh.privacyIntro, /本次修訂新增/);
  for (const t of [en, zh]) assert.doesNotMatch(t.privacyIntro, /2026-09-28/);
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
