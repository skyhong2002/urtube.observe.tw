import { dirname } from 'node:path';

const port = Number(process.env.PORT ?? 3000);
const ingestToken = process.env.INGEST_TOKEN ?? '';
const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : 'http://localhost:3000')).replace(/\/$/, '');
const youtubePrivateDataKey = process.env.YOUTUBE_PRIVATE_DATA_KEY ?? '';
const youtubeCaptureToken = process.env.YOUTUBE_CAPTURE_TOKEN ?? '';
const youtubeSyncHour = Number(process.env.YOUTUBE_SYNC_HOUR ?? 4);
const signupPerHourPerIp = Number(process.env.SIGNUP_PER_HOUR_PER_IP ?? 5);
const maxUsers = Number(process.env.MAX_USERS ?? 25);
const maxUserDatabaseMb = Number(process.env.MAX_USER_DATABASE_MB ?? 512);
const ingestRequestsPerMinute = Number(process.env.INGEST_REQUESTS_PER_MINUTE ?? 300);
const backupIntervalHours = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
const backupRetentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
const aiClassificationEnabled = /^(1|true|yes)$/i.test(
  process.env.AI_CLASSIFICATION_ENABLED ?? ''
);

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
if (ingestToken && ingestToken.length < 32) throw new Error('INGEST_TOKEN must contain at least 32 characters');
if (youtubePrivateDataKey && youtubePrivateDataKey.length < 32) {
  throw new Error('YOUTUBE_PRIVATE_DATA_KEY must contain at least 32 characters');
}
if (youtubeCaptureToken && youtubeCaptureToken.length < 32) {
  throw new Error('YOUTUBE_CAPTURE_TOKEN must contain at least 32 characters');
}
if (!Number.isInteger(youtubeSyncHour) || youtubeSyncHour < 0 || youtubeSyncHour > 23) {
  throw new Error('YOUTUBE_SYNC_HOUR must be an integer from 0 to 23');
}
for (const [name, value] of [
  ['SIGNUP_PER_HOUR_PER_IP', signupPerHourPerIp],
  ['MAX_USERS', maxUsers],
  ['MAX_USER_DATABASE_MB', maxUserDatabaseMb],
  ['INGEST_REQUESTS_PER_MINUTE', ingestRequestsPerMinute],
  ['BACKUP_INTERVAL_HOURS', backupIntervalHours],
  ['BACKUP_RETENTION_DAYS', backupRetentionDays],
] as const) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

export const config = {
  port,
  databasePath: process.env.DATABASE_PATH ?? './data/urtube.sqlite',
  publicBaseUrl,
  ingestToken,
  ownerName: process.env.OWNER_NAME ?? 'Sky Hong',
  // Self-serve signup is on unless explicitly disabled.
  signupEnabled: !/^(0|false|no)$/i.test(process.env.SIGNUP_ENABLED ?? 'true'),
  signupPerHourPerIp,
  maxUsers,
  maxUserDatabaseBytes: maxUserDatabaseMb * 1024 * 1024,
  ingestRequestsPerMinute,
  // "Sign in with Google" for signup/login. Defaults to the Data Portability
  // OAuth client (same Cloud Console project); only the redirect URI differs.
  login: {
    googleClientId: process.env.GOOGLE_LOGIN_CLIENT_ID
      ?? process.env.GOOGLE_DATA_PORTABILITY_CLIENT_ID ?? '',
    googleClientSecret: process.env.GOOGLE_LOGIN_CLIENT_SECRET
      ?? process.env.GOOGLE_DATA_PORTABILITY_CLIENT_SECRET ?? '',
    googleRedirectUri: process.env.GOOGLE_LOGIN_REDIRECT_URI
      ?? `${publicBaseUrl}/auth/google/callback`,
  },
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY ?? '',
    privateDataKey: youtubePrivateDataKey,
    captureToken: youtubeCaptureToken,
    googleClientId: process.env.GOOGLE_DATA_PORTABILITY_CLIENT_ID ?? '',
    googleClientSecret: process.env.GOOGLE_DATA_PORTABILITY_CLIENT_SECRET ?? '',
    googleRedirectUri: process.env.GOOGLE_DATA_PORTABILITY_REDIRECT_URI
      ?? `${publicBaseUrl}/api/ingest/youtube/oauth/callback`,
    syncHour: youtubeSyncHour,
  },
  // Shared channel-tag lists (news / editorial / political leaning) used by
  // the per-user leanings page.
  tagListsUrl: (process.env.TAG_LISTS_URL ?? 'https://urtubeapi.analysis.tw/api/channels_list.php').replace(/\/$/, ''),
  ai: {
    enabled: aiClassificationEnabled,
    baseUrl: (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: process.env.AI_API_KEY ?? '',
    model: process.env.AI_MODEL ?? '',
  },
  opsStatusDirectory: process.env.OPS_STATUS_DIRECTORY
    ?? dirname(process.env.DATABASE_PATH ?? './data/urtube.sqlite'),
  backup: {
    directory: process.env.URTUBE_BACKUP_DIRECTORY ?? '/backups',
    intervalHours: backupIntervalHours,
    retentionDays: backupRetentionDays,
  },
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};
