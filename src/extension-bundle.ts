import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { config } from './config.js';

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
  if (config.publicBaseUrl === 'http://localhost:19080') {
    return `urtube-youtube-capture-local${version ? `-${version}` : ''}.zip`;
  }
  return version ? `urtube-youtube-capture-${version}.zip` : 'urtube-extension.zip';
}

// The unpacked extension, zipped once on first request so new users can
// download exactly what this instance expects (endpoint already pinned).
const extensionZips = new Map<string, Uint8Array>();
export function buildExtensionZip(origin = config.publicBaseUrl): Uint8Array {
  const local = origin === 'http://localhost:19080';
  const cacheKey = local ? 'local' : 'production';
  let extensionZip = extensionZips.get(cacheKey);
  if (!extensionZip) {
    const files: Record<string, Uint8Array> = {};
    for (const name of readdirSync(extensionDirectory)) {
      let bytes = readFileSync(join(extensionDirectory, name));
      // Only the explicitly supported development origin gets a local build.
      // Keep the store extension and other deployments' permissions unchanged.
      if (local && /\.(js|json|html)$/.test(name)) {
        let source = bytes.toString('utf8').replaceAll('https://urtube.observe.tw', origin);
        if (name === 'manifest.json') {
          const manifest = JSON.parse(source);
          manifest.name += ' (Local Development)';
          manifest.action.default_title += ' (Local Development)';
          // Chrome match patterns cover the host; the endpoint validator below
          // restricts manual configuration to the exact development port.
          source = JSON.stringify(manifest, null, 2).replaceAll(`${origin}/`, 'http://localhost/');
        }
        if (name === 'options.js') {
          source = source.replace(
            "url.protocol !== 'https:'\n    || url.hostname !== 'urtube.observe.tw'",
            `url.origin !== '${origin}'`,
          );
        }
        bytes = Buffer.from(source);
      }
      const directory = local ? `${BUNDLE_DIRECTORY}-local` : BUNDLE_DIRECTORY;
      files[`${directory}/${name}`] = bytes;
    }
    extensionZip = zipSync(files, { level: 9 });
    extensionZips.set(cacheKey, extensionZip);
  }
  return extensionZip;
}
