/**
 * LEGACY (unused in the product UI). The owner chose a non-custodial model:
 * users connect Phantom / Solflare / Backpack, or continue in paper mode.
 * Kept so existing localStorage wallets can still be decrypted by the owner if needed.
 * The recovery phrase and secret key were never sent to the server.
 *
 * Derivation: BIP39 mnemonic -> seed -> SLIP-0010 ed25519 path m/44'/501'/0'/0'
 * (same default path as Phantom/Solflare). Storage: AES-256-GCM with a key
 * derived from the user's password via PBKDF2-SHA256 (310k iterations), saved
 * in localStorage.
 */
import { generateMnemonic as gen, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export const STORAGE_KEY = 'cletus.wallet.v1';
export const DEFAULT_PATH = "m/44'/501'/0'/0'";
const PBKDF2_ITERATIONS = 310_000;

export function generateMnemonic(words: 12 | 24 = 12): string {
  return gen(wordlist, words === 24 ? 256 : 128);
}
export function isValidMnemonic(m: string): boolean {
  return validateMnemonic(normalizeMnemonic(m), wordlist);
}
export function normalizeMnemonic(m: string): string {
  return m.trim().toLowerCase().split(/\s+/).join(' ');
}

/** SLIP-0010 ed25519 hardened derivation. */
export function deriveEd25519(seed: Uint8Array, path = DEFAULT_PATH): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = I.slice(0, 32), chain = I.slice(32);
  const segs = path.split('/').slice(1);
  for (const seg of segs) {
    if (!seg.endsWith("'")) throw new Error('ed25519 supports hardened derivation only');
    const idx = (Number(seg.slice(0, -1)) + 0x80000000) >>> 0;
    const data = new Uint8Array(37);
    data[0] = 0;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, idx, false);
    I = hmac(sha512, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32);
  }
  return key;
}

export function keypairFromMnemonic(mnemonic: string, path = DEFAULT_PATH): Keypair {
  const seed = mnemonicToSeedSync(normalizeMnemonic(mnemonic));
  return Keypair.fromSeed(deriveEd25519(seed, path));
}

export function keypairFromSecret(input: string): Keypair {
  const s = input.trim();
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s) as number[]) : bs58.decode(s);
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error('secret key must be 64 bytes (or a 32-byte seed)');
}

export interface EncryptedWallet {
  v: 1;
  kind: 'mnemonic' | 'secretKey';
  publicKey: string;
  salt: string;
  iv: string;
  ct: string;
  iterations: number;
  createdAt: string;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(secret: string, password: string, kind: EncryptedWallet['kind'], publicKey: string, iterations = PBKDF2_ITERATIONS): Promise<EncryptedWallet> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret)));
  return { v: 1, kind, publicKey, salt: b64(salt), iv: b64(iv), ct: b64(ct), iterations, createdAt: new Date().toISOString() };
}

export async function decryptSecret(w: EncryptedWallet, password: string): Promise<string> {
  const key = await deriveAesKey(password, unb64(w.salt), w.iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) as BufferSource }, key, unb64(w.ct) as BufferSource);
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('wrong password');
  }
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letters and numbers.';
  return null;
}

/** Pick `n` distinct word positions (0-based) for the "confirm your phrase" step. */
export function pickConfirmIndices(wordCount: number, n = 3): number[] {
  const set = new Set<number>();
  const rnd = new Uint32Array(16);
  while (set.size < n) {
    crypto.getRandomValues(rnd);
    for (const r of rnd) { if (set.size < n) set.add(r % wordCount); }
  }
  return [...set].sort((a, b) => a - b);
}

export function saveEncryptedWallet(w: EncryptedWallet) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
}
export function loadEncryptedWallet(): EncryptedWallet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EncryptedWallet) : null;
  } catch {
    return null;
  }
}
