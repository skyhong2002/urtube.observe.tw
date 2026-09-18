import { config } from './config.js';
import type { UserRegistry } from './users.js';
import { safeGoogleAvatarUrl } from './avatars.js';

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

export function safeLoginNext(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return '';
  const base = 'https://urtube.invalid';
  try {
    const url = new URL(value, base);
    // Normalization can turn /a/..//host into a protocol-relative path.
    if (url.origin !== base || url.pathname.startsWith('//')) return '';
    return url.pathname + url.search + url.hash;
  } catch { return ''; }
}

export function googleLoginUrl(registry: UserRegistry, next = ''): string {
  if (!googleLoginConfigured()) {
    throw new Error('Google login is not configured (set GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET)');
  }
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.login.googleClientId);
  url.searchParams.set('redirect_uri', config.login.googleRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', registry.createLoginState(next));
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
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.login.googleClientId,
      client_secret: config.login.googleClientSecret,
      redirect_uri: config.login.googleRedirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !body || typeof body.id_token !== 'string') {
    throw new Error('Google token exchange failed');
  }
  // The id_token arrives directly from Google's token endpoint over TLS, so
  // a separate signature-key fetch is unnecessary here. Still validate that
  // this identity token was issued by Google for this client and is current.
  const payload = body.id_token.split('.')[1] ?? '';
  const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Invalid Google identity token');
  const claims = decoded as Record<string, unknown>;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (typeof claims.iss !== 'string' || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
      !config.login.googleClientId || !audiences.every(audience => typeof audience === 'string') || !audiences.includes(config.login.googleClientId) ||
      ((audiences.length > 1 || claims.azp !== undefined) && claims.azp !== config.login.googleClientId) ||
      typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000 ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) {
    throw new Error('Invalid Google identity token');
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
  // Only same-site absolute paths may be continued to after login.
  const next = safeLoginNext(consumed.next);
  return {
    sub,
    email: typeof claims.email === 'string' ? claims.email : '',
    avatarUrl,
    next,
  };
}

// Suggest a handle from the Gmail local part, squeezed into the handle rules.
export function suggestedHandle(email: string): string {
  const local = (email.split('@')[0] ?? '').toLocaleLowerCase('en-US');
  const cleaned = local.replace(/[^a-z0-9.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 32);
  return /^[a-z0-9][a-z0-9.-]{1,31}$/.test(cleaned) ? cleaned : '';
}
