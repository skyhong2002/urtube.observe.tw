// This pure function is shared with the editor's live URL preview.
export function normalizeSocialUrl(platform: string, input: string): string {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return value;
  const bases: Record<string, string> = {
    instagram: 'https://www.instagram.com/',
    threads: 'https://www.threads.com/@',
    youtube: 'https://www.youtube.com/@',
    github: 'https://github.com/',
  };
  if (!Object.hasOwn(bases, platform)) return value;
  const username = value.replace(/^@/, '');
  // Reject paths, query strings, schemes and whitespace; a name is one segment.
  if (!/^[\p{L}\p{M}\p{N}_.-]+$/u.test(username) || username === '.' || username === '..') return value;
  return bases[platform] + encodeURIComponent(username);
}
