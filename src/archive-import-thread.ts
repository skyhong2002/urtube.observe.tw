import { parentPort, workerData } from 'node:worker_threads';
import { importArchiveOnThisThread, type ArchiveImportJob } from './archive-import.js';

try {
  parentPort!.postMessage({ result: importArchiveOnThisThread(workerData as ArchiveImportJob) });
} catch (error) {
  // Only the message crosses back; callers present it like an inline error.
  parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
