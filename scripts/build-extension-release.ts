// Writes release/urtube-youtube-capture-<version>.zip — byte-for-byte the
// same bundle /extension.zip serves, so the Web Store upload and the manual
// download can never be different builds of the same version number.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtensionZip, extensionDownloadName, extensionVersion } from '../src/extension-bundle.js';

const version = extensionVersion();
if (!version) throw new Error('chrome-extension/manifest.json has no version');

const directory = join(fileURLToPath(new URL('..', import.meta.url)), 'release');
mkdirSync(directory, { recursive: true });
const target = join(directory, extensionDownloadName());
const zip = buildExtensionZip();
writeFileSync(target, zip);
console.log(JSON.stringify({ version, file: target, bytes: zip.byteLength }));
