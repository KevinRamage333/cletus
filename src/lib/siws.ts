/**
 * Sign-In-With-Solana (SIWS, CAIP-122 style). Used for authentication only:
 * a message signature that proves the user controls an address. It is not a
 * transaction and does not grant Cletus permission to move funds or to trade.
 */
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

export const SIWS_VERSION = '1';
export const SIWS_CHAIN = 'mainnet';
export const SIWS_STATEMENT =
  'Sign in to Cletus. This signature proves you control this wallet. It is not a transaction and does not give Cletus permission to move funds or to trade.';

export interface SiwsFields {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
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

/** Build the exact SIWS message the wallet will sign. */
export function buildSiwsMessage(f: SiwsFields): string {
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.address,
    '',
    f.statement,
    '',
    `URI: ${f.uri}`,
    `Version: ${f.version}`,
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
  ].join('\n');
}

/** Parse a SIWS message back into fields (strict enough for verification). */
export function parseSiwsMessage(message: string): SiwsFields | null {
  const lines = message.split('\n');
  if (lines.length < 11) return null;
  const want = lines[0].match(/^(.*) wants you to sign in with your Solana account:$/);
  if (!want) return null;
  const field = (prefix: string) => {
    const line = lines.find((l) => l.startsWith(prefix));
    return line ? line.slice(prefix.length) : '';
  };
  const address = lines[1]?.trim();
  if (!address) return null;
  const statementLines: string[] = [];
  for (let i = 3; i < lines.length; i++) {
    if (lines[i].startsWith('URI: ')) break;
    statementLines.push(lines[i]);
  }
  const statement = statementLines.join('\n').replace(/\n$/, '');
  const fields: SiwsFields = {
    domain: want[1],
    address,
    statement,
    uri: field('URI: '),
    version: field('Version: '),
    chainId: field('Chain ID: '),
    nonce: field('Nonce: '),
    issuedAt: field('Issued At: '),
    expirationTime: field('Expiration Time: '),
  };
  if (!fields.uri || !fields.nonce || !fields.issuedAt) return null;
  return fields;
}

export function decodeSignature(signature: string | Uint8Array): Uint8Array | null {
  if (signature instanceof Uint8Array) return signature.length === 64 ? signature : null;
  const s = signature.trim();
  try {
    const b58 = bs58.decode(s);
    if (b58.length === 64) return b58;
  } catch { /* try base64 */ }
  try {
    const bin = Buffer.from(s, 'base64');
    if (bin.length === 64) return new Uint8Array(bin);
  } catch { /* fall through */ }
  return null;
}

/** Verify an ed25519 detached signature over the exact SIWS message bytes. */
export function verifySiwsSignature(message: string, signature: string | Uint8Array, address: string): boolean {
  try {
    const sig = decodeSignature(signature);
    if (!sig) return false;
    const pk = new PublicKey(address).toBytes();
    return nacl.sign.detached.verify(enc.encode(message), sig, pk);
  } catch {
    return false;
  }
}

export interface ChallengeClaims {
  uid: string;
  address: string;
  nonce: string;
  domain: string;
  uri: string;
  iat: number;
  exp: number;
}

export async function signChallenge(claims: ChallengeClaims, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = b64url(await hmac(body, secret));
  return `${body}.${sig}`;
}

export async function verifyChallengeToken(token: string | undefined | null, secret: string, now = Date.now()): Promise<ChallengeClaims | null> {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = b64url(await hmac(body, secret));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as ChallengeClaims;
    if (!claims.uid || !claims.address || !claims.nonce || claims.exp * 1000 < now) return null;
    return claims;
  } catch {
    return null;
  }
}

export function randomNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return b64url(b);
}

export async function issueSiwsChallenge(opts: {
  uid: string; address: string; domain: string; uri: string; secret: string; ttlSec?: number; now?: Date;
}): Promise<{ fields: SiwsFields; message: string; challenge: string; expiresAt: string }> {
  const now = opts.now ?? new Date();
  const ttl = opts.ttlSec ?? 300;
  const exp = new Date(now.getTime() + ttl * 1000);
  const nonce = randomNonce();
  const fields: SiwsFields = {
    domain: opts.domain,
    address: opts.address,
    statement: SIWS_STATEMENT,
    uri: opts.uri,
    version: SIWS_VERSION,
    chainId: SIWS_CHAIN,
    nonce,
    issuedAt: now.toISOString(),
    expirationTime: exp.toISOString(),
  };
  const challenge = await signChallenge({
    uid: opts.uid, address: opts.address, nonce, domain: opts.domain, uri: opts.uri,
    iat: Math.floor(now.getTime() / 1000), exp: Math.floor(exp.getTime() / 1000),
  }, opts.secret);
  return { fields, message: buildSiwsMessage(fields), challenge, expiresAt: exp.toISOString() };
}

/**
 * Full server-side check of a SIWS response: challenge HMAC, message fields,
 * expiry, address match, and ed25519 signature. Returns an error string or null.
 */
export async function verifySiwsResponse(opts: {
  message: string; signature: string; challenge: string; address: string; uid: string; secret: string; now?: number;
}): Promise<string | null> {
  const claims = await verifyChallengeToken(opts.challenge, opts.secret, opts.now);
  if (!claims) return 'sign-in challenge is invalid or expired; request a new one';
  if (claims.uid !== opts.uid) return 'sign-in challenge was issued to a different session';
  if (claims.address !== opts.address) return 'wallet address does not match the sign-in challenge';
  const fields = parseSiwsMessage(opts.message);
  if (!fields) return 'sign-in message could not be parsed';
  if (fields.address !== opts.address) return 'sign-in message address does not match the wallet';
  if (fields.nonce !== claims.nonce) return 'sign-in message nonce does not match the challenge';
  if (fields.domain !== claims.domain) return 'sign-in message domain does not match the challenge';
  if (fields.statement !== SIWS_STATEMENT) return 'sign-in message statement was altered';
  if (fields.version !== SIWS_VERSION || fields.chainId !== SIWS_CHAIN) return 'unsupported sign-in message version';
  const exp = Date.parse(fields.expirationTime);
  if (!Number.isFinite(exp) || exp < (opts.now ?? Date.now())) return 'sign-in message has expired';
  if (!verifySiwsSignature(opts.message, opts.signature, opts.address)) return 'sign-in signature is invalid';
  return null;
}

/** Hosts allowed in the SIWS domain / URI. Preview vercel.app hosts of this project are accepted. */
export function allowedSiwsHost(host: string, env: Record<string, string | undefined> = process.env): boolean {
  const raw = host.trim().toLowerCase().replace(/:\d+$/, '');
  if (!raw) return false;
  const allowed = new Set<string>(['localhost', '127.0.0.1', 'cletusai.xyz', 'www.cletusai.xyz', 'cletusdefi.xyz', 'www.cletusdefi.xyz', 'cletus-autonomous-trader.vercel.app']);
  for (const key of ['NEXT_PUBLIC_SITE_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL']) {
    const v = env[key]?.trim();
    if (!v) continue;
    try { allowed.add(new URL(v.includes('://') ? v : `https://${v}`).host.toLowerCase()); } catch { allowed.add(v.toLowerCase()); }
  }
  for (const d of (env.SIWS_ALLOWED_HOSTS ?? '').split(',')) if (d.trim()) allowed.add(d.trim().toLowerCase());
  if (allowed.has(raw)) return true;
  // Vercel preview / alias hostnames for this project only.
  if (/^cletus-autonomous-trader[a-z0-9-]*-cletus1\.vercel\.app$/.test(raw)) return true;
  return false;
}

export function originFromRequest(req: { headers: Headers }): { host: string; origin: string } | null {
  const proto = (req.headers.get('x-forwarded-proto') || 'http').split(',')[0].trim();
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim();
  if (!host) return null;
  return { host, origin: `${proto}://${host}` };
}
