import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import type { Repository } from '../data/database.js';
import { decryptPrivateValue, encryptPrivateValue } from './crypto.js';
import { parseYoutubeArchive } from './takeout.js';

const SCOPE = 'https://www.googleapis.com/auth/dataportability.myactivity.youtube';
const RESOURCE = 'myactivity.youtube';
const API = 'https://dataportability.googleapis.com/v1';

function requireOAuthConfig(): void {
  if (!config.youtube.googleClientId || !config.youtube.googleClientSecret) {
    throw new Error('Google Data Portability OAuth is not configured');
  }
  if (!config.youtube.privateDataKey) throw new Error('YOUTUBE_PRIVATE_DATA_KEY is required');
}

export function youtubeOAuthAuthorizationUrl(repository: Repository): string {
  requireOAuthConfig();
  const state = randomBytes(24).toString('base64url');
  repository.createYoutubeOAuthState(state, new Date(Date.now() + 10 * 60_000).toISOString());
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.youtube.googleClientId);
  url.searchParams.set('redirect_uri', config.youtube.googleRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  return url.toString();
}

async function tokenRequest(params: URLSearchParams, fetchImpl: typeof fetch = fetch): Promise<any> {
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Google OAuth: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

export async function completeYoutubeOAuth(repository: Repository, code: string, state: string): Promise<void> {
  requireOAuthConfig();
  if (!repository.consumeYoutubeOAuthState(state)) throw new Error('OAuth state is invalid or expired');
  const body = await tokenRequest(new URLSearchParams({
    code,
    redirect_uri: config.youtube.googleRedirectUri,
    client_id: config.youtube.googleClientId,
    client_secret: config.youtube.googleClientSecret,
    grant_type: 'authorization_code',
  }));
  if (!body.refresh_token) throw new Error('Google OAuth response did not include a refresh token');
  repository.saveYoutubeOAuthCredential({
    encryptedRefreshToken: encryptPrivateValue(String(body.refresh_token), config.youtube.privateDataKey),
    expiresAt: body.refresh_token_expires_in
      ? new Date(Date.now() + Number(body.refresh_token_expires_in) * 1000).toISOString()
      : null,
    scope: String(body.scope ?? SCOPE),
    updatedAt: new Date().toISOString(),
  });
}

async function accessToken(repository: Repository, fetchImpl: typeof fetch): Promise<string> {
  requireOAuthConfig();
  const credential = repository.youtubeOAuthCredential();
  if (!credential) throw new Error('YouTube Data Portability has not been authorized');
  if (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now()) {
    throw new Error('YouTube Data Portability authorization has expired');
  }
  const refreshToken = decryptPrivateValue(credential.encryptedRefreshToken, config.youtube.privateDataKey);
  const body = await tokenRequest(new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.youtube.googleClientId,
    client_secret: config.youtube.googleClientSecret,
    grant_type: 'refresh_token',
  }), fetchImpl);
  if (!body.access_token) throw new Error('Google OAuth refresh did not return an access token');
  return String(body.access_token);
}

async function googleJson(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
  init?: RequestInit,
): Promise<any> {
  const response = await fetchImpl(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Data Portability API: HTTP ${response.status}: ${(await response.text()).slice(0, 800)}`);
  return response.json();
}

interface ActiveJob { id: string; endTime: string }

export interface YoutubePortabilityOptions {
  now?: Date;
  fetchImpl?: typeof fetch;
  accessToken?: string;
}

export async function runYoutubePortabilityStep(
  repository: Repository,
  options: YoutubePortabilityOptions = {},
): Promise<'idle' | 'started' | 'in_progress' | 'imported'> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const credential = repository.youtubeOAuthCredential();
  if (!credential && !options.accessToken) return 'idle';
  const token = options.accessToken ?? await accessToken(repository, fetchImpl);
  const activeText = repository.youtubeSyncState('active_job');
  if (activeText) {
    const active = JSON.parse(activeText) as ActiveJob;
    const state = await googleJson(
      `${API}/archiveJobs/${encodeURIComponent(active.id)}/portabilityArchiveState`,
      token,
      fetchImpl,
    );
    if (state.state === 'IN_PROGRESS') return 'in_progress';
    if (state.state !== 'COMPLETE' || !Array.isArray(state.urls) || !state.urls.length) {
      repository.setYoutubeSyncState('last_error', JSON.stringify(state));
      repository.setYoutubeSyncState('active_job', '');
      throw new Error(`Data Portability archive failed: ${JSON.stringify(state).slice(0, 500)}`);
    }
    let watchesInserted = 0;
    let searchesInserted = 0;
    for (const url of state.urls as string[]) {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Data Portability download: HTTP ${response.status}`);
      const archive = new Uint8Array(await response.arrayBuffer());
      const parsed = parseYoutubeArchive(archive, config.youtube.privateDataKey, 'dataportability');
      const result = repository.ingestYoutubeArchive(parsed);
      watchesInserted += result.watchesInserted;
      searchesInserted += result.searchesInserted;
    }
    repository.setYoutubeSyncState('checkpoint', active.endTime);
    repository.setYoutubeSyncState('active_job', '');
    repository.setYoutubeSyncState('last_error', '');
    repository.setYoutubeSyncState('last_result', JSON.stringify({
      watchesInserted,
      searchesInserted,
      completedAt: now.toISOString(),
    }));
    return 'imported';
  }

  const lastStarted = repository.youtubeSyncState('last_started');
  if (lastStarted && now.getTime() - Date.parse(lastStarted) < 24 * 60 * 60_000) return 'idle';
  const taipeiHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', hour: 'numeric', hourCycle: 'h23',
  }).format(now));
  if (taipeiHour !== config.youtube.syncHour) return 'idle';

  const endTime = now.toISOString();
  const checkpoint = repository.youtubeSyncState('checkpoint');
  const startTime = checkpoint
    ? new Date(Date.parse(checkpoint) - 86_400_000).toISOString()
    : undefined;
  const body: Record<string, unknown> = { resources: [RESOURCE], end_time: endTime };
  if (startTime) body.start_time = startTime;
  const started = await googleJson(`${API}/portabilityArchive:initiate`, token, fetchImpl, {
    method: 'POST', body: JSON.stringify(body),
  });
  const id = String(started.archiveJobId ?? '');
  if (!id) throw new Error('Data Portability initiate did not return archiveJobId');
  repository.setYoutubeSyncState('active_job', JSON.stringify({ id, endTime }));
  repository.setYoutubeSyncState('last_started', now.toISOString());
  return 'started';
}
