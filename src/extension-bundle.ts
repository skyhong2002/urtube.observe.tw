import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const extensionDirectory = join(
  fileURLToPath(new URL('..', import.meta.url)),
  'chrome-extension',
);

// Unpacked installs derive their extension ID from the folder path, so the
// directory inside the zip must stay stable across versions: renaming it
// would give Chrome a new ID and drop the stored capture token. The version
// rides on the download filename instead.
const BUNDLE_DIRECTORY = 'urtube-extension';

let cachedExtensionVersion = '';
export function extensionVersion(): string {
  if (!cachedExtensionVersion) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(extensionDirectory, 'manifest.json'), 'utf8'),
      );
      cachedExtensionVersion = String(manifest.version ?? '');
    } catch {
      cachedExtensionVersion = '';
    }
  }
  return cachedExtensionVersion;
}

export function extensionDownloadName(): string {
  const version = extensionVersion();
  return version ? `urtube-youtube-capture-${version}.zip` : 'urtube-extension.zip';
}

// The unpacked extension, zipped once on first request so new users can
// download exactly what this instance expects (endpoint already pinned).
let extensionZip: Uint8Array | null = null;
export function buildExtensionZip(): Uint8Array {
  if (!extensionZip) {
    const files: Record<string, Uint8Array> = {};
    for (const name of readdirSync(extensionDirectory)) {
      files[`${BUNDLE_DIRECTORY}/${name}`] = readFileSync(join(extensionDirectory, name));
    }
    extensionZip = zipSync(files, { level: 9 });
  }
  return extensionZip;
}
