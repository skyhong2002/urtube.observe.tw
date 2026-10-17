// YouTube's channel CDN accepts a size in the final path suffix. Keep the
// original crop/options and leave every other host or URL format alone.
export function channelImageSources(source: string): { src: string; srcset?: string } {
  let url: URL;
  try { url = new URL(source); } catch { return { src: source }; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !['yt3.ggpht.com', 'yt3.googleusercontent.com'].includes(url.hostname)
    || !/=s\d+(?:-[A-Za-z0-9-]+)?$/.test(url.pathname)) return { src: source };
  const sized = (size: number): string => {
    const variant = new URL(url);
    variant.pathname = url.pathname.replace(/=s\d+((?:-[A-Za-z0-9-]+)?)$/, (_, options: string) => `=s${size}${options}`);
    return variant.href;
  };
  return { src: sized(128), srcset: [128, 256, 384].map(size => `${sized(size)} ${size}w`).join(', ') };
}
