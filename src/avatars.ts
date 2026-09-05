import { createHash } from 'node:crypto';
import type { User } from './users.js';

export const AVATAR_FETCH_TIMEOUT_MS = 3_000;
export const AVATAR_MAX_BYTES = 1024 * 1024;
export const AVATAR_CACHE_MAX_ENTRIES = 100;
const AVATAR_CACHE_TTL_MS = 6 * 3600_000;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp',
]);

export interface AvatarImage {
  body: Uint8Array;
  contentType: string;
  source: 'google' | 'fallback';
}

interface CachedAvatar {
  expiresAt: number;
  image: AvatarImage;
}

export function safeGoogleAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'googleusercontent.com' && !url.hostname.endsWith('.googleusercontent.com')) {
      return null;
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function fallbackAvatar(user: User): AvatarImage {
  const initial = [...user.displayName.trim()][0]?.toLocaleUpperCase() ?? '?';
  const escaped = initial.replace(/[<>&'" ]/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;', ' ': '',
  }[character]!));
  const hue = Number.parseInt(createHash('sha256').update(user.keySeed).digest('hex').slice(0, 4), 16) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" rx="80" fill="hsl(${hue} 52% 38%)"/><text x="80" y="84" fill="white" font-family="system-ui,sans-serif" font-size="68" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escaped || '?'}</text></svg>`;
  return { body: Buffer.from(svg), contentType: 'image/svg+xml', source: 'fallback' };
}

async function boundedImage(response: Response): Promise<{ body: Uint8Array; contentType: string } | null> {
  if (!response.ok || !response.body) return null;
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLocaleLowerCase('en-US') ?? '';
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) return null;
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > AVATAR_MAX_BYTES) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > AVATAR_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    return null;
  }
  if (total === 0) return null;
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, contentType };
}

export class AvatarService {
  private readonly cache = new Map<string, CachedAvatar>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async external(url: string): Promise<{ body: Uint8Array; contentType: string } | null> {
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
        redirect: 'manual',
        signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS),
      });
      return await boundedImage(response);
    } catch {
      return null;
    }
  }

  async avatarFor(user: User): Promise<AvatarImage> {
    const key = `${user.id}:${user.avatarUrl ?? ''}:${user.displayName}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.image;
    }
    if (cached) this.cache.delete(key);

    let image: AvatarImage | null = null;
    const googleUrl = safeGoogleAvatarUrl(user.avatarUrl);
    if (googleUrl) {
      const fetched = await this.external(googleUrl);
      if (fetched) image = { ...fetched, source: 'google' };
    }
    image ??= fallbackAvatar(user);
    this.cache.set(key, { expiresAt: Date.now() + AVATAR_CACHE_TTL_MS, image });
    while (this.cache.size > AVATAR_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    return image;
  }
}
