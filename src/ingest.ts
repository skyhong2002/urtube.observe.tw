import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import type { Repository } from './data/database.js';
import { DEFAULT_HANDLE, timingSafeEquals, UserRegistry, type User } from './users.js';
import { securityHeaders } from './security-headers.js';
import { completeYoutubeOAuth, youtubeOAuthAuthorizationUrl } from './youtube/portability.js';
import { parseYoutubeArchive } from './youtube/takeout.js';
import { normalizeYoutubeCapture } from './youtube/capture.js';
import { normalizeYoutubeBackfillBatch, normalizeYoutubeHistoryBatch } from './youtube/history-sync.js';
import { normalizeYoutubeProgressBatch } from './youtube/progress.js';

interface IngestContext {
  user: User;
  repository: Repository;
  dataKey: string;
}

function bearer(auth: string | undefined): string {
  return auth?.startsWith('Bearer ') ? auth.slice(7) : '';
}

export function createIngestApp(registry: UserRegistry): Hono {
  const ingestHits = new Map<number, number[]>();

  // Any per-user capture token (or the legacy env capture token) identifies
  // the calling user; the admin INGEST_TOKEN additionally maps to the
  // instance owner for Takeout uploads and OAuth control.
  function captureContext(auth: string | undefined): IngestContext | null {
    const user = registry.userByCaptureToken(bearer(auth));
    if (!user) return null;
    return { user, repository: registry.repositoryFor(user), dataKey: registry.dataKeyFor(user) };
  }

  function adminContext(auth: string | undefined): IngestContext | null {
    const token = bearer(auth);
    if (config.ingestToken && token && timingSafeEquals(token, config.ingestToken)) {
      const user = registry.ensureDefaultUser();
      return { user, repository: registry.repositoryFor(user), dataKey: registry.dataKeyFor(user) };
    }
    return captureContext(auth);
  }

  function writeQuotaError(context: IngestContext): { error: string; status: 429 | 507 } | null {
    if (registry.databaseBytesFor(context.user) >= config.maxUserDatabaseBytes) {
      return { error: 'This archive has reached its storage limit', status: 507 };
    }
    const now = Date.now();
    const hits = (ingestHits.get(context.user.id) ?? []).filter((at) => now - at < 60_000);
    if (hits.length >= config.ingestRequestsPerMinute) {
      ingestHits.set(context.user.id, hits);
      return { error: 'Too many ingest requests; retry in a minute', status: 429 };
    }
    hits.push(now);
    ingestHits.set(context.user.id, hits);
    return null;
  }

  const app = new Hono();
  app.use('*', securityHeaders());
  app.get('/healthz', (c) => {
    const configured = Boolean(config.ingestToken || config.youtube.captureToken || registry.listUsers().length);
    return c.json(
      { status: configured ? 'healthy' : 'unhealthy', service: 'urtube-ingest' },
      configured ? 200 : 503
    );
  });
  app.post('/api/ingest/youtube/takeout', async (c) => {
    if (!config.ingestToken && !config.youtube.captureToken) {
      return c.json({ error: 'YouTube ingestion is not configured' }, 503);
    }
    const context = adminContext(c.req.header('authorization'));
    if (!context) return c.json({ error: 'Unauthorized' }, 401);
    const quota = writeQuotaError(context);
    if (quota) return c.json({ error: quota.error }, quota.status);
    if (!context.dataKey) return c.json({ error: 'YOUTUBE_PRIVATE_DATA_KEY is not configured' }, 503);
    const contentType = c.req.header('content-type')?.split(';')[0]?.trim();
    if (!['application/zip', 'application/octet-stream'].includes(contentType ?? '')) {
      return c.json({ error: 'Upload the Takeout ZIP as application/zip' }, 415);
    }
    try {
      const archive = new Uint8Array(await c.req.arrayBuffer());
      const parsed = parseYoutubeArchive(archive, context.dataKey, 'takeout');
      const result = context.repository.ingestYoutubeArchive(parsed);
      registry.markCrystalDirty(context.user);
      return c.json({ ok: true, user: context.user.handle, ...result, totals: context.repository.youtubeCounts() }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.get('/api/ingest/youtube/capture/status', (c) => {
    if (!config.youtube.captureToken && !registry.listUsers().length) {
      return c.json({ error: 'YouTube capture is not configured' }, 503);
    }
    const context = captureContext(c.req.header('authorization'));
    if (!context) return c.json({ error: 'Unauthorized' }, 401);
    return c.json({ status: 'ready', service: 'urtube-youtube-capture', user: context.user.handle });
  });
  app.post('/api/ingest/youtube/capture', async (c) => {
    if (!config.youtube.captureToken && !registry.listUsers().length) {
      return c.json({ error: 'YouTube capture is not configured' }, 503);
    }
    const context = captureContext(c.req.header('authorization'));
    if (!context) return c.json({ error: 'Unauthorized' }, 401);
    const quota = writeQuotaError(context);
    if (quota) return c.json({ error: quota.error }, quota.status);
    try {
      const body = await c.req.text();
      if (Buffer.byteLength(body) > 16 * 1024) {
        return c.json({ error: 'Capture payload exceeds 16 KiB' }, 413);
      }
      const input = normalizeYoutubeCapture(JSON.parse(body));
      const result = context.repository.upsertYoutubeCapture(input);
      registry.markCrystalDirty(context.user);
      return c.json({ ok: true, ...result }, result.inserted ? 201 : 200);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.post('/api/ingest/youtube/progress', async (c) => {
    if (!config.youtube.captureToken && !registry.listUsers().length) {
      return c.json({ error: 'YouTube capture is not configured' }, 503);
    }
    const context = captureContext(c.req.header('authorization'));
    if (!context) return c.json({ error: 'Unauthorized' }, 401);
    const quota = writeQuotaError(context);
    if (quota) return c.json({ error: quota.error }, quota.status);
    try {
      const body = await c.req.text();
      if (Buffer.byteLength(body) > 96 * 1024) {
        return c.json({ error: 'Progress payload exceeds 96 KiB' }, 413);
      }
      const input = normalizeYoutubeProgressBatch(JSON.parse(body));
      const result = context.repository.ingestYoutubeProgress(input);
      registry.markCrystalDirty(context.user);
      return c.json({ ok: true, ...result }, result.completed ? 200 : 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.get('/api/ingest/youtube/history/status', (c) => {
    if (!config.youtube.captureToken && !registry.listUsers().length) {
      return c.json({ error: 'YouTube capture is not configured' }, 503);
    }
    const context = captureContext(c.req.header('authorization'));
    if (!context) return c.json({ error: 'Unauthorized' }, 401);
    return c.json({ status: 'ready', ...context.repository.youtubeHistoryStatus() });
  });
  // Deep backfill from the YouTube history page: day-precision watch events
  // derived from the page's date groups (no 90-day window — the whole point
  // is reaching years back). Search terms never ride this path, so no data
  // key is required.
  app.post('/api/ingest/youtube/backfill', async (c) => {
    if (!config.youtube.captureToken && !registry.listUsers().length) {
      return c.json({ error: 'YouTube capture is not configured' }, 503);
    }
    const context = captureContext(c.req.header('authorization'));
    if (!context) return c.json({ error: 'Unauthorized' }, 401);
    const quota = writeQuotaError(context);
    if (quota) return c.json({ error: quota.error }, quota.status);
    try {
      const body = await c.req.text();
      if (Buffer.byteLength(body) > 256 * 1024) {
        return c.json({ error: 'Backfill payload exceeds 256 KiB' }, 413);
      }
      const input = normalizeYoutubeBackfillBatch(JSON.parse(body));
      const result = context.repository.ingestYoutubeArchive(input);
      registry.markCrystalDirty(context.user);
      return c.json({ ok: true, user: context.user.handle, ...result }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post('/api/ingest/youtube/history', async (c) => {
    if (!config.youtube.captureToken && !registry.listUsers().length) {
      return c.json({ error: 'YouTube capture is not configured' }, 503);
    }
    const context = captureContext(c.req.header('authorization'));
    if (!context) return c.json({ error: 'Unauthorized' }, 401);
    const quota = writeQuotaError(context);
    if (quota) return c.json({ error: quota.error }, quota.status);
    if (!context.dataKey) {
      return c.json({ error: 'YOUTUBE_PRIVATE_DATA_KEY is not configured' }, 503);
    }
    try {
      const body = await c.req.text();
      if (Buffer.byteLength(body) > 256 * 1024) {
        return c.json({ error: 'History payload exceeds 256 KiB' }, 413);
      }
      const input = normalizeYoutubeHistoryBatch(
        JSON.parse(body),
        context.dataKey,
      );
      const result = context.repository.ingestYoutubeArchive(input);
      registry.markCrystalDirty(context.user);
      return c.json({
        ok: true,
        ...result,
        history: context.repository.youtubeHistoryStatus(),
      }, 200);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  // Google Data Portability stays owner-only for now: the OAuth client and
  // worker are configured for the instance owner's account.
  app.post('/api/ingest/youtube/oauth/start', (c) => {
    const context = adminContext(c.req.header('authorization'));
    if (!context || context.user.handle !== DEFAULT_HANDLE) return c.json({ error: 'Unauthorized' }, 401);
    try {
      return c.json({ authorizationUrl: youtubeOAuthAuthorizationUrl(context.repository) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 503);
    }
  });
  app.get('/api/ingest/youtube/oauth/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return c.text('Missing OAuth code or state', 400);
    try {
      const user = registry.ensureDefaultUser();
      await completeYoutubeOAuth(registry.repositoryFor(user), code, state);
      return c.redirect('/youtube?oauth=connected');
    } catch (error) {
      return c.text(error instanceof Error ? error.message : String(error), 400);
    }
  });
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const registry = new UserRegistry(process.env.USERS_DATABASE_PATH ?? './data/users.sqlite');
  if (config.youtube.captureToken || config.ingestToken) registry.ensureDefaultUser();
  const app = createIngestApp(registry);
  serve({ fetch: app.fetch, port: config.port }, (info) => console.log(`urtube ingest listening on :${info.port}`));
}
