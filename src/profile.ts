import { z } from 'zod';

export const RESERVED_HANDLES = new Set(['landing-assets', 'avatar', 'blend', 'channel', 'dashboard', 'docs', 'matching-v3', 'matches', 'members', 'onboarding', 'account', 'admin', 'api', 'auth', 'compare', 'extension-setup', 'extension-version.json', 'extension.zip', 'favicon.svg', 'healthz', 'login', 'logout', 'og.png', 'privacy', 'readyz', 'robots.txt', 'signup', 'sitemap.xml', 'status', 'support', 'youtube', 'www', 'urtube', 'u']);
export function validHandle(handle: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{1,31}$/.test(handle) && !RESERVED_HANDLES.has(handle);
}
const textLength = (max: number) => (value: string) => [...value].length <= max;
export const profileSchema = z.object({
  displayName: z.string().trim().min(1).refine(textLength(80)),
  handle: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,31}$/),
  bio: z.string().refine(textLength(300)).transform(value => value.trim() ? value : ''),
  socialLinks: z.array(z.object({
    name: z.string().trim().min(1).refine(textLength(40)),
    url: z.string().trim().max(2048).refine(value => {
      try { const url = new URL(value); return /^https?:$/.test(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; }
      catch { return false; }
    }),
  })).max(5),
});
export type ProfileInput = z.infer<typeof profileSchema>;
export class ProfileError extends Error {
  constructor(public readonly field: keyof ProfileInput, public readonly reason: 'invalid' | 'taken' = 'invalid') { super(`${field}: ${reason}`); }
}
