import { createApp as rawApp } from '../src/index.js';
import { config } from '../src/config.js';
export * from '../src/index.js';

// Existing UI integration tests represent same-origin form submissions. Supply
// the header a browser adds automatically; retain explicitly supplied origins.
// Security tests import the raw app to exercise missing/forged browser headers.
export function createApp(...args: Parameters<typeof rawApp>) {
  const app = rawApp(...args);
  const request = app.request.bind(app);
  app.request = (input, init, env, context) => {
    if (!(input instanceof Request) && init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase())) {
      const headers = new Headers(init.headers);
      if (!headers.has('origin')) headers.set('origin', new URL(config.publicBaseUrl).origin);
      init = { ...init, headers };
    }
    return request(input, init, env, context);
  };
  return app;
}
