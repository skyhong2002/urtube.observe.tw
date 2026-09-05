// One-shot cache-only rebuild. No providers, no cache deletion, no raw histories exported.
import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { UserRegistry } from '../src/users.js';
import { settings, version } from '../src/matching-v3/model.js';
import { computeClient } from '../src/matching-v3/compute.js';
import { cachedPreview } from '../src/matching-v3/preview.js';

const s = settings();
if (!s.enabled) throw new Error('Matching must be enabled');
const path = process.env.USERS_DATABASE_PATH ?? '/data/users.sqlite';
const registry = new UserRegistry(path);
const db = new DatabaseSync(path);
db.exec('PRAGMA busy_timeout=5000');
const staged: { id: number; handle: string; old: string | null; profile: Awaited<ReturnType<typeof cachedPreview>> }[] = [];
try {
  const users = registry.listUsers();
  for (const user of users) {
    const row = db.prepare('SELECT profile_json FROM matching_v3_profiles WHERE user_id=?').get(user.id);
    const old = row ? String(row.profile_json) : null;
    const previous = old ? JSON.parse(old) : null;
    if (previous?.version === version(s)) continue;
    const source = registry.repositoryFor(user).matchingV3Source(s.backfillVideoLimit);
    const profile = await cachedPreview(source, registry.matchingV3Store(), s, computeClient(s));
    if (previous?.sourceFingerprint === source.fingerprint && previous.genres['channel type']) {
      profile.genres['channel type'] = previous.genres['channel type'];
    }
    staged.push({id:user.id,handle:user.handle,old,profile});
    console.log(JSON.stringify({built:staged.length,users:users.length,clusters:Object.values(profile.genres).reduce((n,g)=>n+g.clusters.length,0)}));
  }
  // Recheck the source immediately before activation; a changed account waits
  // for the regular worker rather than publishing a stale replacement.
  const valid = staged.filter(item => {
    const user=registry.userByHandle(item.handle);
    return user?.id===item.id && registry.repositoryFor(user).matchingV3Source(s.backfillVideoLimit).fingerprint===item.profile.sourceFingerprint;
  });
  const directory = process.env.MATCHING_PROFILE_BACKUP_DIR ?? '/data/matching-profile-backups';
  mkdirSync(directory,{recursive:true,mode:0o700});
  const backup = `${directory}/before-compact-${Date.now()}.json`;
  writeFileSync(backup,JSON.stringify(valid.map(({id,old})=>({id,profile:old}))),{mode:0o600});
  let published=0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const item of valid) {
      const json=JSON.stringify(item.profile);
      const result=item.old===null
        ? db.prepare('INSERT OR IGNORE INTO matching_v3_profiles(user_id,profile_json) VALUES(?,?)').run(item.id,json)
        : db.prepare('UPDATE matching_v3_profiles SET profile_json=? WHERE user_id=? AND profile_json=?').run(json,item.id,item.old);
      published+=Number(result.changes);
    }
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  console.log(JSON.stringify({published,skipped:staged.length-published,version:version(s),backup}));
} finally {db.close();registry.close();}
