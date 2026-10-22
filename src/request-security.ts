import type { Context, MiddlewareHandler } from 'hono';

export class PayloadTooLarge extends Error {
  constructor() { super('Request payload exceeds the size limit'); }
}

// Content-Length can reject a request early, but cannot prove its actual size.
// Do not await cancellation: an uncooperative peer must not delay the 413.
export async function readLimitedBody(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get('content-length')) > maxBytes) {
    void request.body?.cancel().catch(() => {});
    throw new PayloadTooLarge();
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new PayloadTooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

// Keep the existing middleware options and route-specific error responses,
// while enforcing the limit even for missing or understated Content-Length.
export function bodyLimit(options: {
  maxSize: number;
  onError?: (c: Context) => Response | Promise<Response>;
}): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.raw.body) {
      try {
        const body = await readLimitedBody(c.req.raw, options.maxSize);
        c.req.raw = new Request(c.req.raw, { body });
      } catch (error) {
        if (error instanceof PayloadTooLarge) return options.onError ? options.onError(c) : c.text('Payload Too Large', 413);
        return c.json({ error: 'Unable to read request body' }, 400);
      }
    }
    await next();
  };
}

// Session writes need browser evidence of the configured origin. Legacy
// clients may use Referer or Fetch Metadata only when Origin is absent.
// Bearer ingest is a separate app and deliberately does not use this guard.
export function sameOriginWrites(baseUrl: string): MiddlewareHandler {
  const origin = new URL(baseUrl).origin;
  return async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const supplied = c.req.header('origin');
      let allowed = supplied === origin;
      if (supplied === undefined) {
        const referer = c.req.header('referer');
        if (referer !== undefined) {
          try { allowed = new URL(referer).origin === origin; } catch { /* fail closed */ }
        } else allowed = c.req.header('sec-fetch-site') === 'same-origin';
      }
      if (!allowed || c.req.header('sec-fetch-site') === 'cross-site') {
        return c.json({ error: 'invalid_origin' }, 403);
      }
    }
    await next();
  };
}

// Run outside authentication, origin and body guards so redirects and errors
// carrying signup identities or session-specific output are protected too.
export function privateResponses(): MiddlewareHandler {
  return async (c, next) => {
    const sensitive = /^\/(?:auth|login|signup|logout|account|onboarding|extension-setup|dashboard|matches|(?:api\/)?matching-v3|api\/processing|status|healthz|readyz)(?:\/|$)/.test(c.req.path)
      || /(?:^|;\s*)urtube_(?:session|signup|dash_[^=]+)=/.test(c.req.header('cookie') ?? '');
    await next();
    if (sensitive) c.header('Cache-Control', 'private, no-store');
  };
}
