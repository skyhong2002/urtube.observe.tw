import { config } from './config.js';
import type { UserRegistry } from './users.js';
import { safeGoogleAvatarUrl } from './avatars.js';

// "Sign in with Google" (openid + email only). The point is account
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

export function googleLoginUrl(registry: UserRegistry, next = ''): string {
  if (!googleLoginConfigured()) {
    throw new Error('Google login is not configured (set GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET)');
  }
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.login.googleClientId);
  url.searchParams.set('redirect_uri', config.login.googleRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
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
  if (!response.ok || typeof body.id_token !== 'string') {
    throw new Error(`Google token exchange failed: ${JSON.stringify(body).slice(0, 300)}`);
  }
  // The id_token arrives directly from Google's token endpoint over TLS, so
  // decoding without signature verification is safe here.
  const payload = body.id_token.split('.')[1] ?? '';
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;
  const sub = String(claims.sub ?? '');
  if (!sub) throw new Error('Google id_token is missing the sub claim');
  // Only same-site absolute paths may be continued to after login.
  const next = consumed.next.startsWith('/') && !consumed.next.startsWith('//') ? consumed.next : '';
  return {
    sub,
    email: claims.email ? String(claims.email) : '',
    avatarUrl: safeGoogleAvatarUrl(claims.picture),
    next,
  };
}

// Suggest a handle from the Gmail local part, squeezed into the handle rules.
export function suggestedHandle(email: string): string {
  const local = (email.split('@')[0] ?? '').toLocaleLowerCase('en-US');
  const cleaned = local.replace(/[^a-z0-9.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 32);
  return /^[a-z0-9][a-z0-9.-]{1,31}$/.test(cleaned) ? cleaned : '';
}
