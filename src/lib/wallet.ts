/**
 * SERVER-ONLY. Loads the operator trading wallet from TRADING_WALLET_PRIVATE_KEY
 * (base58 or JSON byte array) or TRADING_WALLET_KEYPAIR_PATH (solana-keygen JSON).
 * The secret key is never logged, serialised, or returned by any API; only the
 * public key leaves this module.
 */
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'node:fs';
import path from 'node:path';

if (typeof window !== 'undefined') throw new Error('wallet.ts must never be imported in the browser');

function parseSecret(raw: string): Uint8Array {
  const s = raw.trim();
  if (s.startsWith('[')) return Uint8Array.from(JSON.parse(s) as number[]);
  return bs58.decode(s);
}

let kp: Keypair | null = null;

/** Internal: returns the signing keypair. Only the executor should call this. */
export function loadTradingKeypair(): Keypair {
  if (kp) return kp;
  let secret: Uint8Array;
  if (process.env.TRADING_WALLET_PRIVATE_KEY?.trim()) {
    secret = parseSecret(process.env.TRADING_WALLET_PRIVATE_KEY);
  } else if (process.env.TRADING_WALLET_KEYPAIR_PATH?.trim()) {
    const p = path.resolve(process.cwd(), process.env.TRADING_WALLET_KEYPAIR_PATH.trim());
    secret = parseSecret(fs.readFileSync(p, 'utf8'));
  } else {
    throw new Error('No trading wallet configured');
  }
  if (secret.length !== 64) throw new Error('Trading wallet secret has an invalid length');
  kp = Keypair.fromSecretKey(secret);
  secret.fill(0);
  return kp;
}

/** Public address of the operator wallet, or null if none is configured / readable. */
export function getOperatorPublicKey(): string | null {
  try {
    return loadTradingKeypair().publicKey.toBase58();
  } catch {
    return null;
  }
}
