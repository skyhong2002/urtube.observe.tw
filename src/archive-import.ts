import { Worker } from 'node:worker_threads';
import { Repository } from './data/database.js';
import { parseYoutubeArchive, parseYoutubeArchiveFile, type YoutubeArchiveLimits } from './youtube/takeout.js';
import type { YoutubeImportResult, YoutubeParsedArchive } from './youtube/types.js';

interface ArchiveImportBase {
  databasePath: string;
  dataKey: string;
  source: YoutubeParsedArchive['source'];
  limits?: YoutubeArchiveLimits;
}
// Uploads arrive as a temporary file (src/takeout-upload.ts) that the import
// reads without loading it whole; the caller deletes it afterwards.
// archiveHash is the SHA-256 computed while it was received.
export type ArchiveImportJob = ArchiveImportBase & ({ archive: Uint8Array } | { archivePath: string; archiveHash?: string });

// Unzipping and ingesting a Takeout archive is synchronous work that can take
// many seconds. On the request thread that stalls every other visitor (#92
// R08), so file-backed archives import on a worker thread with its own
// SQLite connection; WAL lets this process keep serving reads.
export function importArchive(repository: Repository, job: ArchiveImportJob): Promise<YoutubeImportResult> {
  // An in-memory database cannot be shared with another thread (tests).
  if (job.databasePath === ':memory:') return ingest(repository, job);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./archive-import-thread.ts', import.meta.url), {
      workerData: job,
      transferList: 'archive' in job ? [job.archive.buffer as ArrayBuffer] : [],
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

async function ingest(repository: Repository, job: ArchiveImportJob): Promise<YoutubeImportResult> {
  const parsed = 'archive' in job
    ? parseYoutubeArchive(job.archive, job.dataKey, job.source, job.limits)
    : await parseYoutubeArchiveFile(job.archivePath, job.dataKey, job.source, { ...job.limits, archiveHash: job.archiveHash });
  return repository.ingestYoutubeArchive(parsed);
}

export async function importArchiveOnThisThread(job: ArchiveImportJob): Promise<YoutubeImportResult> {
  const repository = new Repository(job.databasePath);
  try {
    return await ingest(repository, job);
  } finally {
    repository.close();
  }
}
