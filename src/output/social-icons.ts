// Inline vectors keep profile icons available without external requests.
export const SOCIAL_PRESETS = [
  { id: 'instagram', name: 'Instagram', placeholder: 'https://www.instagram.com/username/', hosts: ['instagram.com'] },
  { id: 'threads', name: 'Threads', placeholder: 'https://www.threads.com/@username', hosts: ['threads.com', 'threads.net'] },
  { id: 'youtube', name: 'YouTube', placeholder: 'https://www.youtube.com/@channel', hosts: ['youtube.com', 'youtu.be'] },
  { id: 'github', name: 'GitHub', placeholder: 'https://github.com/username', hosts: ['github.com'] },
  { id: 'website', name: 'Website', placeholder: 'https://example.com', hosts: [] },
] as const;
export type SocialPlatform = typeof SOCIAL_PRESETS[number]['id'];
export function socialPlatform(value: string): SocialPlatform {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return SOCIAL_PRESETS.find(preset => preset.hosts.some(domain => host === domain || host.endsWith('.' + domain)))?.id ?? 'website';
  } catch { return 'website'; }
}
const artwork: Record<SocialPlatform, string> = {
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/>',
  threads: '<path d="M20 7C18.8 3.6 16.2 2 12.3 2 6 2 3 6 3 12s3 10 9.3 10c5.1 0 8.7-2.8 8.7-7 0-4.5-4.3-6.3-8.1-6.3-3.2 0-5.1 1.4-5.1 3.7 0 2 1.4 3.4 3.5 3.4 3.1 0 4.3-2.5 4.3-5.8 0-3.2-1.3-4.7-3.6-4.7-1.5 0-2.7.6-3.5 1.7"/>',
  youtube: '<path d="M21 7.5a2.5 2.5 0 0 0-1.8-1.8C17.5 5.2 12 5.2 12 5.2s-5.5 0-7.2.5A2.5 2.5 0 0 0 3 7.5a22 22 0 0 0 0 9 2.5 2.5 0 0 0 1.8 1.8c1.7.5 7.2.5 7.2.5s5.5 0 7.2-.5a2.5 2.5 0 0 0 1.8-1.8 22 22 0 0 0 0-9Z"/><path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none"/>',
  github: '<path fill="currentColor" stroke="none" d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.08c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.62 1.22 3.26.93.1-.73.39-1.22.71-1.5-2.5-.28-5.12-1.25-5.12-5.55 0-1.22.44-2.22 1.15-3-.12-.29-.5-1.42.11-2.95 0 0 .94-.3 3.08 1.15A10.8 10.8 0 0 1 12 6.2c.95 0 1.9.13 2.8.38 2.14-1.45 3.08-1.15 3.08-1.15.61 1.53.23 2.66.11 2.95.72.78 1.15 1.78 1.15 3 0 4.31-2.63 5.26-5.13 5.54.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z"/>',
  website: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/>',
};
export function socialIcon(platform: SocialPlatform): string {
  return `<svg class="social-icon" data-platform="${platform}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="flex-shrink:0;vertical-align:middle">${artwork[platform]}</svg>`;
}
