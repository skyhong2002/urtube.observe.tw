import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import type { YoutubeCrystal } from '../youtube/crystal.js';
import type { PortableAccountData } from '../users.js';
import type { PortableExportTable, Repository } from './database.js';

export interface UserDataExportOptions {
  repository: Repository;
  dataKey: string;
  account: PortableAccountData;
  personalCrystal: YoutubeCrystal;
  exportedAt?: Date;
}

interface ExportFile {
  name: string;
  chunks: () => Iterable<Uint8Array>;
}

function fieldDescriptions(names: string[]): Array<{ name: string; description: string }> {
  return names.map((name) => ({
    name,
    description: `Top-level ${name.replaceAll(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} value.`,
  }));
}

function documentChunks(value: unknown): Iterable<Uint8Array> {
  return [strToU8(`${JSON.stringify(value, null, 2)}\n`)];
}

function* tableChunks(table: PortableExportTable): Iterable<Uint8Array> {
  yield strToU8('[\n');
  let first = true;
  for (const row of table.rows()) {
    yield strToU8(`${first ? '' : ',\n'}${JSON.stringify(row)}`);
    first = false;
  }
  yield strToU8('\n]\n');
}

async function* zipChunks(files: ExportFile[], close: () => void): AsyncGenerator<Uint8Array> {
  const pending: Uint8Array[] = [];
  let failure: Error | null = null;
  const archive = new Zip((error, chunk) => {
    if (error) failure = error;
    else if (chunk?.length) pending.push(chunk);
  });
  const drain = function* (): Iterable<Uint8Array> {
    while (pending.length) yield pending.shift()!;
    if (failure) throw failure;
  };
  try {
    for (const file of files) {
      const entry = new ZipPassThrough(file.name);
      archive.add(entry);
      yield* drain();
      for (const chunk of file.chunks()) {
        entry.push(chunk);
        yield* drain();
      }
      entry.push(new Uint8Array(), true);
      yield* drain();
    }
    archive.end();
    yield* drain();
  } finally {
    archive.terminate();
    close();
  }
}

function readableStream(
  generator: AsyncGenerator<Uint8Array>,
  close: () => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await generator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      try {
        await generator.return(undefined);
      } finally {
        close();
      }
    },
  });
}

export function userDataExport(options: UserDataExportOptions): {
  filename: string;
  stream: ReadableStream<Uint8Array>;
} {
  const exportedAt = options.exportedAt ?? new Date();
  const snapshot = options.repository.openPortableExport(options.dataKey);
  let snapshotClosed = false;
  const closeSnapshot = () => {
    if (snapshotClosed) return;
    snapshotClosed = true;
    snapshot.close();
  };
  const documents = [
    {
      name: 'account.json',
      description: 'Account identity and archive visibility owned by the exporting user.',
      source: 'user registry',
      fields: fieldDescriptions([
        'handle', 'displayName', 'googleAccountId', 'googleEmail',
        'dashboardPublic', 'referenceOptIn', 'createdAt', 'onboardingCompletedAt',
      ]),
      value: options.account.account,
    },
    {
      name: 'matching.json',
      description: 'Matching settings, invitations, and connections without another user’s private profile or contact details.',
      source: 'user registry',
      fields: fieldDescriptions(['settings', 'invitations', 'connections']),
      value: options.account.matching,
    },
    {
      name: 'personal-crystal.json',
      description: 'Current personal aggregate used by the archive insights.',
      source: 'derived from the user database at export time',
      fields: fieldDescriptions(Object.keys(options.personalCrystal)),
      value: options.personalCrystal,
    },
    {
      name: 'matching-crystal.json',
      description: 'Current bounded matching projection, or null when it has not been built.',
      source: 'user registry',
      fields: fieldDescriptions(options.account.matchingCrystal
        ? Object.keys(options.account.matchingCrystal) : ['value']),
      value: options.account.matchingCrystal,
    },
  ];
  const manifest = {
    format: 'urtube-portable-export',
    formatVersion: 1,
    schemaVersion: snapshot.schemaVersion,
    exportedAt: exportedAt.toISOString(),
    owner: options.account.account.handle,
    sources: ['Google Takeout', 'Google Data Portability', 'urtube YouTube Capture', 'public YouTube metadata', 'urtube derived data'],
    excluded: [
      'login, dashboard, capture, OAuth, and action tokens',
      'other users’ private traits, introductions, and contact details',
      'content still held only by Google or YouTube',
    ],
    files: [
      ...documents.map(({ name, description, source, fields }) => ({
        name,
        description,
        source,
        rowCount: 1,
        fields,
      })),
      ...snapshot.tables.map(({ file: name, description, source, rowCount, columns }) => ({
        name,
        description,
        source,
        rowCount,
        fields: columns,
      })),
    ],
  };
  const files: ExportFile[] = [
    { name: 'manifest.json', chunks: () => documentChunks(manifest) },
    ...documents.map((document) => ({
      name: document.name,
      chunks: () => documentChunks(document.value),
    })),
    ...snapshot.tables.map((table) => ({
      name: table.file,
      chunks: () => tableChunks(table),
    })),
  ];
  const generator = zipChunks(files, closeSnapshot);
  const day = exportedAt.toISOString().slice(0, 10);
  return {
    filename: `urtube-${options.account.account.handle}-${day}.zip`,
    stream: readableStream(generator, closeSnapshot),
  };
}
