import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { User, UserRegistry } from '../users.js';
import { GENRES, genreSchema, selectionSchema, version, type Settings } from './model.js';
import { computeClient, type Compute } from './compute.js';
import { compareProfiles } from './matching.js';
import { sourceKey } from './store.js';
import { matchingPage } from './page.js';
import { adminPage } from './admin-page.js';

const preferencesSchema = z.object({
  genres: z.array(genreSchema).max(9).refine(g => new Set(g).size === g.length),
  topics: z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(60), genres: selectionSchema })).max(50),
}).strict().refine(p => new Set(p.topics.map(t => t.id)).size === p.topics.length && p.topics.every(t => t.genres.every(g => p.genres.includes(g))));

export function matchingRoutes(registry: UserRegistry, s: Settings, origin: string, compute: Compute = computeClient(s)) {
  const app = new Hono<{ Variables: { user: User } }>();
  if (!s.enabled) return app;
  const store = registry.matchingV3Store();
  const busy = new Set<number>();
  const authorize: MiddlewareHandler<{ Variables: { user: User } }> = async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    const user = registry.userBySession(getCookie(c, 'urtube_session') ?? '');
    if (!user) return c.req.path === '/matching-v3' ? c.redirect('/auth/google?next=%2Fmatching-v3') : c.json({ error: 'login_required' }, 401);
    if (c.req.method !== 'GET' && c.req.header('Origin') !== new URL(origin).origin) return c.json({ error: 'invalid_origin' }, 403);
    c.set('user', user);
    await next();
  };
  for (const path of ['/matching-v3', '/matching-v3/*', '/api/matching-v3', '/api/matching-v3/*']) {
    app.use(path, bodyLimit({ maxSize: 32 * 1024 }), authorize);
  }
  const isAdmin = (user: User) => s.adminHandles.includes(user.handle);
  const adminOnly: MiddlewareHandler<{ Variables: { user: User } }> = async (c, next) => {
    if (!isAdmin(c.get('user'))) return c.json({ error: 'admin_required' }, 403);
    await next();
  };
  for (const path of ['/matching-v3/admin', '/matching-v3/admin.js', '/api/matching-v3/admin', '/api/matching-v3/admin/*']) app.use(path, adminOnly);
  app.get('/matching-v3/admin', c => c.html(adminPage()));
  app.get('/matching-v3/admin.js', c => {
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    return c.body(readFileSync(new URL('./admin.js', import.meta.url), 'utf8'));
  });
  app.get('/api/matching-v3/admin', c => {
    const users = registry.listUsers().map(user => {
      const p = store.profile(user.id), currentVersion = p?.version === version(s);
      return { id: user.id, handle: user.handle, job: store.status(user.id), currentVersion,
        usable: Boolean(currentVersion && p && Object.values(p.genres).some(g => g.status === 'ready')),
        profile: p ? { builtAt: p.builtAt, totalVideos: p.totalVideos, processedVideos: p.processedVideos,
          genres: Object.fromEntries(Object.entries(p.genres).map(([genre, value]) => [genre, { status: value.status }])) } : null };
    });
    return c.json({ ...store.monitoring(), now: Date.now(), dailyLimit: s.dailyApiCalls, concurrency: s.concurrency, batchSize: s.classificationBatchSize, classificationModel: s.classificationModel, reasoningEffort: 'low', genres: GENRES, users });
  });
  app.post('/api/matching-v3/admin/retry/:id', c => {
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id) || !registry.listUsers().some(u => u.id === id)) return c.json({ error: 'unknown_user' }, 404);
    if (store.status(id)?.state === 'running') return c.json({ error: 'already_running' }, 409);
    store.retry(id);
    return c.json({ queued: true }, 202);
  });
  app.get('/matching-v3', c => c.html(matchingPage(isAdmin(c.get('user')))));
  app.get('/matching-v3/client.js', c => {
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    return c.body(readFileSync(new URL('./client.js', import.meta.url), 'utf8'));
  });
  app.get('/api/matching-v3', c => {
    const user = c.get('user'), profile = store.profile(user.id);
    return c.json({ genres: GENRES, optedIn: user.matchingOptIn, preferences: store.preferences(user.id),
      job: store.status(user.id),
      profile: profile ? { builtAt: profile.builtAt, complete: profile.complete, totalVideos: profile.totalVideos,
        processedVideos: profile.processedVideos, currentVersion: profile.version === version(s),
        genres: Object.fromEntries(Object.entries(profile.genres).map(([g, p]) => [g, { status: p.status, videoCount: p.videoCount, retainedCoverage: p.retainedCoverage }])) } : null });
  });
  app.put('/api/matching-v3/preferences', async c => {
    const parsed = preferencesSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_preferences' }, 400);
    const user = c.get('user');
    if (parsed.data.genres.length && !user.matchingOptIn) return c.json({ error: 'opt_in_required' }, 403);
    store.savePreferences(user.id, parsed.data);
    return c.json({ saved: true });
  });
  app.post('/api/matching-v3/rebuild', c => {
    const user = c.get('user'), prefs = store.preferences(user.id);
    if (!user.matchingOptIn || !prefs.genres.length) return c.json({ error: 'opt_in_required' }, 403);
    const source = registry.repositoryFor(user).matchingV3Source();
    store.schedule(user.id, sourceKey(source.fingerprint, { genres: [...GENRES], topics: [] }), version(s));
    store.retry(user.id);
    return c.json({ queued: true }, 202);
  });
  app.post('/api/matching-v3/match', async c => {
    const parsed = z.object({ genres: selectionSchema }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_genres' }, 400);
    const user = c.get('user'), selected = parsed.data.genres;
    if (!user.matchingOptIn || selected.some(g => !store.preferences(user.id).genres.includes(g))) return c.json({ error: 'opt_in_required' }, 403);
    if (busy.has(user.id)) return c.json({ error: 'matching_in_progress' }, 429);
    const left = store.profile(user.id);
    if (!left || left.version !== version(s)) return c.json({ error: 'profile_pending' }, 409);
    busy.add(user.id);
    try {
      const candidates = [];
      for (const other of registry.listUsers()) {
        if (other.id === user.id || !other.matchingOptIn) continue;
        const consent = store.preferences(other.id).genres;
        if (selected.some(g => !consent.includes(g))) continue;
        const right = store.profile(other.id);
        if (!right || right.version !== version(s)) continue;
        const result = await compareProfiles(
          { ...left, complete: left.complete && store.status(user.id)?.state === 'done' },
          { ...right, complete: right.complete && store.status(other.id)?.state === 'done' }, selected, compute);
        // Recheck consent after async computation; opt-out must apply immediately.
        const freshOther = registry.userByHandle(other.handle);
        if (!freshOther?.matchingOptIn || selected.some(g => !store.preferences(other.id).genres.includes(g))) continue;
        if (store.profile(other.id)?.builtAt !== right.builtAt) continue;
        candidates.push({ id: randomUUID(), ...result });
      }
      if (!registry.userByHandle(user.handle)?.matchingOptIn || selected.some(g => !store.preferences(user.id).genres.includes(g))) return c.json({ error: 'opt_in_required' }, 403);
      if (store.profile(user.id)?.builtAt !== left.builtAt) return c.json({ error: 'profile_changed' }, 409);
      candidates.sort((a, b) => Number(a.provisional) - Number(b.provisional) || (b.score ?? -1) - (a.score ?? -1));
      // Preserve anonymous discovery. No handles, raw watch rows or vectors.
      return c.json({ candidates, selected, scoreMeaning: 'selected_genres_equal_weight_distribution_similarity' });
    } catch { return c.json({ error: 'matching_unavailable' }, 503); }
    finally { busy.delete(user.id); }
  });
  return app;
}
