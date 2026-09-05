// Fast, high-confidence repository guard for release day. It deliberately
// reports file names only: a failed audit must never copy a credential into CI
// output. This complements (rather than replaces) provider-side secret
// scanning and credential rotation.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const patterns = [
  { name: 'private key', source: String.raw`-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----` },
  { name: 'GitHub token', source: String.raw`(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})` },
  { name: 'OpenAI-style secret', source: String.raw`sk-[A-Za-z0-9_-]{20,}` },
  { name: 'Google API key', source: String.raw`AIza[0-9A-Za-z_-]{30,}` },
  { name: 'Google OAuth token', source: String.raw`ya29\.[0-9A-Za-z_-]{20,}` },
  { name: 'Slack token', source: String.raw`xox[baprs]-[A-Za-z0-9-]{20,}` },
  { name: 'AWS access key', source: String.raw`AKIA[0-9A-Z]{16}` },
] as const;

function git(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
const failures = new Set<string>();

for (const file of files) {
  const basename = file.split('/').at(-1) ?? file;
  const forbidden = (
    (basename === '.env' || (basename.startsWith('.env.') && basename !== '.env.example'))
    || /^(?:id_rsa|id_ed25519)$/.test(basename)
    || /\.(?:sqlite(?:-wal|-shm)?|pem|p12|pfx)$/i.test(basename)
  );
  if (forbidden) failures.add(`forbidden tracked path: ${file}`);

  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  const content = bytes.toString('utf8');
  for (const pattern of patterns) {
    if (new RegExp(pattern.source, 'g').test(content)) {
      failures.add(`${pattern.name} pattern in tracked file: ${file}`);
    }
  }
}

for (const pattern of patterns) {
  const names = git([
    'log', '--all', '--extended-regexp', '--format=', '--name-only',
    '-G', pattern.source,
  ]).split('\n').map((name) => name.trim()).filter(Boolean);
  for (const name of new Set(names)) {
    failures.add(`${pattern.name} pattern in git history: ${name}`);
  }
}

if (failures.size > 0) {
  console.error('Security audit failed (values intentionally omitted):');
  for (const failure of [...failures].sort()) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Security audit passed: ${files.length} tracked files and git history checked; no high-confidence secret or forbidden path found.`);
}
