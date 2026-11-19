// Admin sign-in with Amazon Cognito's hosted login page (OAuth 2.0 authorization code + PKCE).
// Tokens live in sessionStorage, so closing the tab signs out.
// Settings come from /config.json: written by scripts/deploy.mjs on AWS, {"mode":"dev"} locally.

export type AuthConfig = { mode: 'cognito'; domain: string; clientId: string } | { mode: 'dev' } | { mode: 'none' };

const TOKENS = 'mbq-admin-tokens';
const PKCE = 'mbq-admin-pkce';
const redirectUri = () => location.origin + '/admin';

interface Tokens { access: string; email: string | null; expiresAt: number }

const ss = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k: string) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

function decodeJwt(t: string): Record<string, unknown> {
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('config');
  return res.json();
}

/** A valid access token, or null if signed out or expired. */
export function currentToken(cfg: AuthConfig): { token: string; email: string | null } | null {
  if (cfg.mode === 'dev') return { token: 'dev', email: 'local dev (no sign-in)' };
  if (cfg.mode !== 'cognito') return null;
  const raw = ss.get(TOKENS);
  if (!raw) return null;
  const t: Tokens = JSON.parse(raw);
  if (Date.now() > t.expiresAt - 60_000) { ss.del(TOKENS); return null; }
  return { token: t.access, email: t.email };
}

export async function signIn(cfg: Extract<AuthConfig, { mode: 'cognito' }>) {
  const verifier = random(48);
  const state = random(16);
  ss.set(PKCE, JSON.stringify({ verifier, state }));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({
    response_type: 'code', client_id: cfg.clientId, redirect_uri: redirectUri(),
    scope: 'openid email', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  location.assign(cfg.domain + '/oauth2/authorize?' + q);
}

/** Finishes sign-in when Cognito redirects back with ?code=…; returns true if it handled a callback. */
export async function completeSignIn(cfg: AuthConfig): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return false;
  history.replaceState(null, '', '/admin');
  if (error || cfg.mode !== 'cognito') throw new Error(params.get('error_description') || error || 'Sign-in failed');

  const saved = ss.get(PKCE);
  ss.del(PKCE);
  const { verifier, state } = saved ? JSON.parse(saved) : ({} as { verifier?: string; state?: string });
  if (!verifier || state !== params.get('state')) throw new Error('Sign-in expired. Please try again.');

  const res = await fetch(cfg.domain + '/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: cfg.clientId, code: code!, redirect_uri: redirectUri(), code_verifier: verifier }),
  });
  if (!res.ok) throw new Error('Sign-in failed. Please try again.');
  const t = await res.json();
  const id = decodeJwt(t.id_token);
  ss.set(TOKENS, JSON.stringify({ access: t.access_token, email: (id.email as string) ?? null, expiresAt: Date.now() + t.expires_in * 1000 } satisfies Tokens));
  return true;
}

export function signOut(cfg: AuthConfig) {
  ss.del(TOKENS);
  if (cfg.mode === 'cognito') {
    location.assign(cfg.domain + '/logout?' + new URLSearchParams({ client_id: cfg.clientId, logout_uri: redirectUri() }));
  }
}

/** Drop a token the API rejected (expired or revoked) without leaving the page. */
export const forgetToken = () => ss.del(TOKENS);
