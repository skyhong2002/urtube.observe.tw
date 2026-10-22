import type { ServerType } from '@hono/node-server';

// cloudflared keeps idle origin connections for 90 seconds by default, while
// Node closes them after 5. A request the tunnel sends on a socket Node just
// closed reads EOF and the visitor sees HTTP 502, even though the app is up.
// The origin must therefore outlive the proxy's idle pool.
export const ORIGIN_KEEP_ALIVE_TIMEOUT_MS = 95_000;
export const ORIGIN_HEADERS_TIMEOUT_MS = 100_000;

export function outliveProxyKeepAlive(server: ServerType): ServerType {
  if ('keepAliveTimeout' in server) {
    server.keepAliveTimeout = ORIGIN_KEEP_ALIVE_TIMEOUT_MS;
    // Node requires headersTimeout above keepAliveTimeout, or an idle socket
    // can be torn down by the header timer first.
    server.headersTimeout = ORIGIN_HEADERS_TIMEOUT_MS;
  }
  return server;
}
