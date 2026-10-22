import { Worker } from 'node:worker_threads';
import { Repository } from './data/database.js';
import { parseYoutubeArchive } from './youtube/takeout.js';
import type { YoutubeImportResult, YoutubeParsedArchive } from './youtube/types.js';

export interface ArchiveImportJob {
  databasePath: string;
  archive: Uint8Array;
  dataKey: string;
  source: YoutubeParsedArchive['source'];
}

// Unzipping and ingesting a Takeout archive (up to 100 MiB) is synchronous
// and can take many seconds. On the request thread that stalls every other
// visitor (#92 R08), so file-backed archives import on a worker thread with
// its own SQLite connection; WAL lets this process keep serving reads.
export function importArchive(repository: Repository, job: ArchiveImportJob): Promise<YoutubeImportResult> {
  // An in-memory database cannot be shared with another thread (tests).
  if (job.databasePath === ':memory:') return Promise.resolve(ingest(repository, job));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./archive-import-thread.ts', import.meta.url), {
      workerData: job,
      transferList: [job.archive.buffer as ArrayBuffer],
    });
    let settled = false;
    worker.once('message', (message: { result?: YoutubeImportResult; error?: string }) => {
      settled = true;
      if (message.error !== undefined) reject(new Error(message.error));
      else resolve(message.result!);
    });
    worker.once('error', (error) => { settled = true; reject(error); });
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(`Archive import stopped unexpectedly (exit ${code})`));
    });
  });
}

function ingest(repository: Repository, job: ArchiveImportJob): YoutubeImportResult {
  return repository.ingestYoutubeArchive(parseYoutubeArchive(job.archive, job.dataKey, job.source));
}

export function importArchiveOnThisThread(job: ArchiveImportJob): YoutubeImportResult {
  const repository = new Repository(job.databasePath);
  try {
    return ingest(repository, job);
  } finally {
    repository.close();
  }
}
