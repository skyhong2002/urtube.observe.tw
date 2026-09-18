import type { MiddlewareHandler } from 'hono';

export class PayloadTooLarge extends Error {
  constructor() { super('Request payload exceeds the size limit'); }
}

// Count bytes as they arrive, even when Content-Length is missing or untrue.
// Cancellation must not delay the 413 if the peer does not finish its stream.
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

export function limitedBody(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      try {
        const body = await readLimitedBody(c.req.raw, maxBytes);
        c.req.raw = new Request(c.req.raw, { body });
      } catch (error) {
        if (error instanceof PayloadTooLarge) return c.json({ error: error.message }, 413);
        return c.json({ error: 'Unable to read request body' }, 400);
      }
    }
    await next();
  };
}

// Browser cookie writes require proof of the exact origin. Requests from older
// clients may use Referer; absent or opaque origins fail closed. Bearer ingest
// has a separate application and does not use this middleware.
export function sameOriginWrites(baseUrl: string): MiddlewareHandler {
  const origin = new URL(baseUrl).origin;
  return async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const supplied = c.req.header('origin');
      let allowed = supplied === origin;
      if (supplied === undefined) {
        const referer = c.req.header('referer');
        if (referer) {
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
