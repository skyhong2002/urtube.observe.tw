import type { DatabaseSync } from 'node:sqlite';
import type { Profile } from './model.js';
import type { JobProgress } from './store.js';

// Read-only queries shared by the diagnostic store API and the isolated reader.
export function readMonitoring(db: DatabaseSync) {
  return {
    heartbeat: db.prepare('SELECT heartbeat FROM matching_v3_worker_status WHERE id=1').get()?.heartbeat ?? null,
    cache: db.prepare(`SELECT CASE WHEN json_type(value_json)='array' THEN 'embedding'
      WHEN json_type(value_json,'$.assignments')='array' THEN 'classification' ELSE 'channel' END kind,
      count(*) count,max(created_at) latest FROM matching_v3_cache GROUP BY kind`).all(),
    budget: db.prepare('SELECT day,calls FROM matching_v3_api_budget WHERE day=?').get(new Date().toISOString().slice(0,10)) ?? { calls: 0 },
    operations: db.prepare('SELECT * FROM matching_v3_operations ORDER BY id DESC LIMIT 50').all(),
    recent: db.prepare(`SELECT kind,status,count(*) calls,sum(items) items,sum(COALESCE(valid_items,CASE WHEN status='success' THEN items ELSE 0 END)) valid_items,max(finished_at) latest,avg(finished_at-started_at) average_ms
      FROM matching_v3_operations WHERE started_at>=? GROUP BY kind,status`).all(Date.now()-300000),
  };
}

export function readAdminSnapshot(db: DatabaseSync, profileVersion: string) {
  const users = db.prepare(`SELECT u.id, u.handle, p.profile_json,
    j.state, j.attempts, j.error, j.retry_at, j.progress_json
    FROM users u LEFT JOIN matching_v3_profiles p ON p.user_id=u.id
    LEFT JOIN matching_v3_jobs j ON j.user_id=u.id ORDER BY u.id`).all().map(row => {
      const p: Profile | null = row.profile_json ? JSON.parse(String(row.profile_json)) : null;
      const currentVersion = p?.version === profileVersion;
      return { id: Number(row.id), handle: String(row.handle), currentVersion,
        job: row.state == null ? null : { state: String(row.state), attempts: Number(row.attempts),
          error: row.error == null ? null : String(row.error), retry_at: Number(row.retry_at),
          progress: row.progress_json ? JSON.parse(String(row.progress_json)) as JobProgress : null },
        usable: Boolean(currentVersion && p && Object.values(p.genres).some(g => g.status === 'ready')),
        profile: p ? { builtAt: p.builtAt, totalVideos: p.totalVideos, processedVideos: p.processedVideos,
          genres: Object.fromEntries(Object.entries(p.genres).map(([genre, value]) =>
            [genre, { status: value.status, clusterCount: value.clusters.length }])) } : null };
    });
  return { ...readMonitoring(db), users, sampledAt: Date.now() };
}

export type AdminSnapshot = ReturnType<typeof readAdminSnapshot>;
