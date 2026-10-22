import { config } from './config.js';
import type { UserRegistry } from './users.js';
import { safeGoogleAvatarUrl } from './avatars.js';
import { createHash } from 'node:crypto';

// "Sign in with Google" (openid + email + profile). The point is account
// uniqueness: Google's `sub` claim is a permanent per-account id, so one
// Google account can never own two urtube users. Email is stored for display;
// it is NOT the key (emails can change, sub cannot).

export interface GoogleIdentity {
  sub: string;
  email: string;
  avatarUrl: string | null;
  // Same-site path to continue to after login, carried through OAuth state.
  next: string;
}

export function googleLoginConfigured(): boolean {
  return Boolean(config.login.googleClientId && config.login.googleClientSecret);
}

// Domain-separated from the random, single-use state; no extra persistent
// secret or schema is needed. Every login has its own cookie for parallel tabs.
export const loginNonce = (state: string) => createHash('sha256').update(`urtube-oidc-nonce:${state}`).digest('base64url');
export const loginStateCookie = (state: string) => `urtube_login_state_${createHash('sha256').update(state).digest('hex').slice(0, 32)}`;

export function googleLoginUrl(registry: UserRegistry, next = ''): string {
  if (!googleLoginConfigured()) {
    throw new Error('Google login is not configured (set GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET)');
  }
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.login.googleClientId);
  url.searchParams.set('redirect_uri', config.login.googleRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  const state = registry.createLoginState(next);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', loginNonce(state));
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export async function completeGoogleLogin(
  registry: UserRegistry,
  code: string,
  state: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleIdentity> {
  const consumed = registry.consumeLoginState(state);
  if (!consumed.valid) throw new Error('OAuth state is invalid or expired');
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.login.googleClientId,
      client_secret: config.login.googleClientSecret,
      redirect_uri: config.login.googleRedirectUri,
      grant_type: 'authorization_code',
    }).toString(),
    // A hung token endpoint must not hold the login request open indefinitely.
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !body || typeof body.id_token !== 'string') {
    throw new Error('Google token exchange failed');
  }
  // This token is obtained exclusively from Google's authenticated TLS token
  // endpoint, never from the browser. Validate the OIDC claims as well as that
  // trusted delivery channel; do not accept a token for another client/flow.
  if (body.id_token.length > 16384 || body.id_token.split('.').length !== 3) throw new Error('Invalid Google identity token');
  const payload = body.id_token.split('.')[1];
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;
  const audience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
  const now = Date.now() / 1000;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)
    || typeof claims.iss !== 'string' || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)
    || !config.login.googleClientId || !audience.every(aud => typeof aud === 'string') || !audience.includes(config.login.googleClientId)
    || ((audience.length > 1 || claims.azp !== undefined) && claims.azp !== config.login.googleClientId)
    || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now
    || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > now + 60 || claims.iat >= claims.exp
    || claims.nonce !== loginNonce(state)
    || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) {
    throw new Error('Invalid Google identity claims');
  }
  const sub = claims.sub;
  let avatarUrl = safeGoogleAvatarUrl(claims.picture);
  if (!avatarUrl && typeof body.access_token === 'string') {
    try {
      const infoResponse = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${body.access_token}` },
        redirect: 'error', signal: AbortSignal.timeout(3_000),
      });
      if (infoResponse.ok) {
        const info = await infoResponse.json() as Record<string, unknown>;
        if (info.sub === sub) avatarUrl = safeGoogleAvatarUrl(info.picture);
      }
    } catch { /* A missing profile image must not prevent sign-in. */ }
  }
  return {
    sub,
    email: typeof claims.email === 'string' ? claims.email : '',
    avatarUrl,
    next: sameSitePath(consumed.next),
  };
}

// Only same-site absolute paths may be continued to after login. Browsers
// treat a backslash like a slash, so `/\evil.example` is protocol-relative too.
export function sameSitePath(next: string): string {
  if (!next.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(next)) return '';
  const base = new URL(config.publicBaseUrl);
  try {
    const target = new URL(next, base);
    // Dot-segment normalization can turn /a/..//host into //host, which a
    // Location header would interpret as an external destination.
    return target.origin === base.origin && !target.pathname.startsWith('//')
      ? `${target.pathname}${target.search}${target.hash}` : '';
  } catch {
    return '';
  }
}

// Suggest a handle from the Gmail local part, squeezed into the handle rules.
export function suggestedHandle(email: string): string {
  const local = (email.split('@')[0] ?? '').toLocaleLowerCase('en-US');
  const cleaned = local.replace(/[^a-z0-9.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 32);
  return /^[a-z0-9][a-z0-9.-]{1,31}$/.test(cleaned) ? cleaned : '';
}
