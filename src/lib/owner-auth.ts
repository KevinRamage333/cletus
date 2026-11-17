/**
 * Owner (operator) session: a separate httpOnly signed cookie, issued only after
 * Sign-In-With-Solana from OWNER_WALLET (defaults to PAYOUT_WALLET).
 * Auth only — the signature never grants trading or withdrawal rights.
 */
import { PublicKey } from '@solana/web3.js';
import { getSessionSecret } from './session';

export const OWNER_COOKIE = 'cletus_owner';
export const OWNER_COOKIE_TTL_SEC = 60 * 60 * 24 * 7;

export interface OwnerSession {
  typ: 'owner';
  addr: string;
  nonce: string;
  iat: number;
  exp: number;
}

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

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Canonicalize a base58 address; null if invalid. */
export function canonicalAddress(input: string | null | undefined): string | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  try {
    const pk = new PublicKey(s);
    const addr = pk.toBase58();
    return addr === s ? addr : null;
  } catch {
    return null;
  }
}

export function addressesEqual(a?: string | null, b?: string | null): boolean {
  const x = canonicalAddress(a);
  const y = canonicalAddress(b);
  return Boolean(x && y && x === y);
}

/** Use only the configured owner or payout address. */
export function resolveOwnerWallet(env: Record<string, string | undefined> = process.env): string {
  return env.OWNER_WALLET?.trim()
    ? canonicalAddress(env.OWNER_WALLET) ?? ''
    : canonicalAddress(env.PAYOUT_WALLET) ?? '';
}

export function isOwnerWallet(address: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return addressesEqual(address, resolveOwnerWallet(env));
}

export function ownerCookieOptions(maxAge = OWNER_COOKIE_TTL_SEC) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    path: '/',
    maxAge,
  };
}

export async function signOwnerSession(addr: string, secret = getSessionSecret(), ttlSec = OWNER_COOKIE_TTL_SEC, now = Math.floor(Date.now() / 1000), nonce = crypto.randomUUID()): Promise<string> {
  const canonical = canonicalAddress(addr);
  if (!canonical) throw new Error('invalid owner address');
  const claims: OwnerSession = { typ: 'owner', addr: canonical, nonce, iat: now, exp: now + ttlSec };
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = b64url(await hmac(body, secret));
  return `${body}.${sig}`;
}

export async function verifyOwnerSession(token: string | undefined | null, secret = getSessionSecret(), now = Math.floor(Date.now() / 1000), env: Record<string, string | undefined> = process.env): Promise<OwnerSession | null> {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = b64url(await hmac(body, secret));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as OwnerSession;
    if (claims.typ !== 'owner' || !claims.addr || claims.exp < now) return null;
    if (!isOwnerWallet(claims.addr, env)) return null;
    return claims;
  } catch {
    return null;
  }
}
