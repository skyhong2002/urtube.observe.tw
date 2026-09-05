// Isolated, loopback-only profile preview. Never use this entrypoint in production.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const previewDir = resolve('data/profile-preview');
mkdirSync(previewDir, { recursive: true });
// Set these before importing application modules to prevent the production
// entrypoint from starting and to keep all preview data in its own directory.
process.env.NODE_ENV = 'test';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4317';
process.env.DATABASE_PATH = resolve(previewDir, 'owner.sqlite');
process.env.USERS_DATABASE_PATH = resolve(previewDir, 'registry.sqlite');
process.env.GOOGLE_LOGIN_CLIENT_ID = '';
process.env.GOOGLE_LOGIN_CLIENT_SECRET = '';
process.env.YOUTUBE_PRIVATE_DATA_KEY = '';
process.env.YOUTUBE_CAPTURE_TOKEN = '';
process.env.INGEST_TOKEN = '';

const { serve } = await import('@hono/node-server');
const { UserRegistry } = await import('../src/users.js');
const { createApp } = await import('../src/index.js');
const registry = new UserRegistry(process.env.USERS_DATABASE_PATH, resolve(previewDir, 'users'));
let user = registry.listUsers()[0];
if (!user) {
  user = registry.createUser('profile-demo', '個人檔案測試');
  user = registry.updateProfile(user.id, {
    ...user,
    bio: '這是本機測試帳號。\n試著編輯名稱、ID、簡介與社群連結。',
    socialLinks: [{ name: '個人網站', url: 'https://example.com' }],
  });
}
const session = registry.createSession(user);
const app = createApp(registry);
const server = serve({
  hostname: '127.0.0.1', port: 4317,
  fetch: request => {
    // Authenticate only this disposable preview account, preserving language
    // preferences and other ordinary browser cookies. No production DB is used.
    const headers = new Headers(request.headers);
    const cookies = (headers.get('cookie') ?? '').split(';').filter(cookie => !cookie.trim().startsWith('urtube_session=')).filter(cookie => cookie.trim());
    cookies.push(`urtube_session=${session}`);
    headers.set('cookie', cookies.join('; '));
    return app.fetch(new Request(request, { headers }));
  },
}, () => {
  console.log('本機測試帳號（與正式帳號分開），資料保存於 data/profile-preview。');
  console.log('開啟 http://127.0.0.1:4317/account/profile?lang=zh');
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => { registry.close(); process.exit(0); }));
}
