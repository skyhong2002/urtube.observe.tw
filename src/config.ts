const port = Number(process.env.PORT ?? 3000);
const ingestToken = process.env.INGEST_TOKEN ?? '';
const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : 'http://localhost:3000')).replace(/\/$/, '');
const youtubePrivateDataKey = process.env.YOUTUBE_PRIVATE_DATA_KEY ?? '';
const youtubeCaptureToken = process.env.YOUTUBE_CAPTURE_TOKEN ?? '';
const youtubeSyncHour = Number(process.env.YOUTUBE_SYNC_HOUR ?? 4);
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

export const config = {
  port,
  databasePath: process.env.DATABASE_PATH ?? './data/urtube.sqlite',
  publicBaseUrl,
  ingestToken,
  ownerName: process.env.OWNER_NAME ?? 'Sky Hong',
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
  ai: {
    enabled: aiClassificationEnabled,
    baseUrl: (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: process.env.AI_API_KEY ?? '',
    model: process.env.AI_MODEL ?? '',
  },
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};
