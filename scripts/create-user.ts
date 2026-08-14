// Create (or rotate tokens for) a user on this urtube instance. Tokens are
// printed exactly once; only hashes are stored. Usage:
//   npx tsx scripts/create-user.ts <handle> "<Display Name>" [--public]
//   npx tsx scripts/create-user.ts <handle> --rotate
import { config } from '../src/config.js';
import { UserRegistry } from '../src/users.js';

const registryPath = process.env.USERS_DATABASE_PATH ?? './data/users.sqlite';
const [handle, ...rest] = process.argv.slice(2);

if (!handle) {
  console.error('Usage: npx tsx scripts/create-user.ts <handle> "<Display Name>" [--public] | <handle> --rotate | <handle> --delete');
  process.exit(2);
}

const registry = new UserRegistry(registryPath);
try {
  if (rest.includes('--rename')) {
    const newHandle = rest[rest.indexOf('--rename') + 1];
    if (!newHandle) throw new Error('Usage: <handle> --rename <new-handle>');
    const user = registry.renameUser(handle, newHandle);
    console.log(JSON.stringify({
      renamed: { from: handle, to: user.handle },
      note: 'Tokens and the encryption key are unchanged; the dashboard URL moved.',
      dashboard: `${config.publicBaseUrl}/u/${user.handle}`,
    }, null, 2));
  } else if (rest.includes('--delete')) {
    registry.deleteUser(handle);
    console.log(JSON.stringify({ handle, deleted: true, note: 'User row and their database file were removed.' }, null, 2));
  } else if (rest.includes('--rotate')) {
    const tokens = registry.rotateTokens(handle);
    console.log(JSON.stringify({ handle, ...tokens, note: 'Old tokens are now invalid.' }, null, 2));
  } else {
    const displayName = rest.find((value) => !value.startsWith('--')) ?? handle;
    const user = registry.createUser(handle, displayName, {
      dashboardPublic: rest.includes('--public'),
    });
    console.log(JSON.stringify({
      handle: user.handle,
      displayName: user.displayName,
      captureToken: user.captureToken,
      dashboardToken: user.dashboardToken,
      extension: {
        endpoint: `${config.publicBaseUrl}/api/ingest/youtube/capture`,
        token: user.captureToken,
      },
      dashboard: user.dashboardPublic
        ? `${config.publicBaseUrl}/u/${user.handle}`
        : `${config.publicBaseUrl}/u/${user.handle}?key=${user.dashboardToken}`,
    }, null, 2));
  }
} finally {
  registry.close();
}
