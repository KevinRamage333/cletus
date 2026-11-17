/**
 * Signed session cookie (HMAC-SHA256 via Web Crypto; works in Edge middleware and Node).
 * The cookie carries onboarding claims so middleware can gate routes without a DB call;
 * API routes re-check the database as the source of truth.
 */
export const SESSION_COOKIE = 'cletus_session';

export interface SessionClaims {
  uid: string;
  email: string;
  adm: boolean;
  av: string | null; // age attestation version
  tv: string | null; // accepted terms version
  rv: string | null; // acknowledged risk version
  fc: string | null; // completed five-stage financial consent version
  w: boolean; // wallet set up
  iat: number;
  exp: number;
}

// A separate signing context invalidates sessions issued before unverified sign-in was disabled.
const SESSION_CONTEXT = 'cletus-session-v2:';
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function getSessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production' && process.env.CLETUS_ALLOW_DEV_SECRET !== 'true') {
    throw new Error('SESSION_SECRET (>=32 chars) is required in production');
  }
  return 'dev-only-insecure-session-secret-change-me-0123456789';
}

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function signSession(claims: Omit<SessionClaims, 'iat' | 'exp'>, secret = getSessionSecret(), ttlSec = 60 * 60 * 24 * 14): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(enc.encode(JSON.stringify({ ...claims, iat: now, exp: now + ttlSec })));
  const sig = b64url(await hmac(SESSION_CONTEXT + body, secret));
  return `${body}.${sig}`;
}

export async function verifySession(token: string | undefined | null, secret = getSessionSecret()): Promise<SessionClaims | null> {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = b64url(await hmac(SESSION_CONTEXT + body, secret));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const raw = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Partial<SessionClaims>;
    if (!raw.uid || !raw.email || typeof raw.exp !== 'number' || raw.exp < Math.floor(Date.now() / 1000)) return null;
    // Older sessions must re-enter any newly introduced eligibility/consent gates.
    return { ...raw, av: typeof raw.av === 'string' ? raw.av : null, fc: typeof raw.fc === 'string' ? raw.fc : null } as SessionClaims;
  } catch {
    return null;
  }
}
