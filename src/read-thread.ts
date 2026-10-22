import { parentPort } from 'node:worker_threads';
import { Repository } from './data/database.js';
import { runRead, type ReadRequests } from './read-pool.js';

const repositories = new Map<string, Repository>();

parentPort!.on('message', (message: { id: number; databasePath: string; kind: keyof ReadRequests; args: ReadRequests[keyof ReadRequests] }) => {
  try {
    let repository = repositories.get(message.databasePath);
    if (!repository) {
      repository = new Repository(message.databasePath, { readOnly: true });
      repositories.set(message.databasePath, repository);
    }
    parentPort!.postMessage({ id: message.id, value: runRead(repository, message.kind, message.args) });
  } catch (error) {
    parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
});
