import { UserRegistry } from '../src/users.js';
import { settings } from '../src/matching-v3/model.js';
import { bootstrapMatching } from '../src/matching-v3/bootstrap.js';
const s = settings();
if (!s.enabled) throw new Error('Enable matching v3 before bootstrapping');
const registry = new UserRegistry(process.env.USERS_DATABASE_PATH ?? './data/users.sqlite');
try { console.log(JSON.stringify(bootstrapMatching(registry, s))); }
finally { registry.close(); }
