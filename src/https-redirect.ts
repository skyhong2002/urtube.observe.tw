import type { MiddlewareHandler } from 'hono';
import { config } from './config.js';

export function forceHttps(publicBaseUrl = config.publicBaseUrl): MiddlewareHandler {
  const canonical = new URL(publicBaseUrl);
  return async (c, next) => {
    const requested = new URL(c.req.url);
    // Origin ports are loopback-only. Cloudflare supplies X-Forwarded-Proto
    // for the visitor connection; the tunnel's origin hop itself uses HTTP.
    // Never redirect that HTTPS visitor back to the same URL in a loop.
    const visitorScheme = c.req.header('x-forwarded-proto')?.trim().toLowerCase()
      ?? requested.protocol.slice(0, -1);
    if (canonical.protocol === 'https:' && requested.hostname === canonical.hostname
      && visitorScheme === 'http') {
      // Fixed origin prevents protocol-relative paths or forwarded host values
      // from changing the destination. 308 preserves upload methods and bodies.
      return c.redirect(`${canonical.origin}${requested.pathname}${requested.search}`, 308);
    }
    // Local health checks and HTTP development origins remain reachable.
    await next();
  };
}
