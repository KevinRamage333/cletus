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
import { AsyncLocalStorage } from 'node:async_hooks';

if (typeof window !== 'undefined') throw new Error('wallet.ts must never be imported in the browser');

function parseSecret(raw: string): Uint8Array {
  const s = raw.trim();
  if (s.startsWith('[')) return Uint8Array.from(JSON.parse(s) as number[]);
  return bs58.decode(s);
}

let kp: Keypair | null = null;

/**
 * Wallet context: the KOL/pump.fun add-on mode trades from its own wallet (KOL_WALLET_KEYPAIR_PATH or
 * KOL_WALLET_PRIVATE_KEY). Code run inside withKolWallet() signs, sizes and reads balances with that wallet;
 * everything else (main strategy, profit sweep, withdrawals) uses the operator wallet.
 */
const walletCtx = new AsyncLocalStorage<'kol'>();
export function withKolWallet<T>(fn: () => T): T { return walletCtx.run('kol', fn); }
export function activeWalletName(): 'kol' | 'operator' { return walletCtx.getStore() ?? 'operator'; }

let kolKp: Keypair | null = null;
/** Internal: the KOL-mode signing keypair. Throws when not configured (KOL entries are then skipped). */
export function loadKolKeypair(): Keypair {
  if (kolKp) return kolKp;
  let secret: Uint8Array;
  if (process.env.KOL_WALLET_KEYPAIR_PATH?.trim()) {
    secret = parseSecret(fs.readFileSync(path.resolve(process.cwd(), process.env.KOL_WALLET_KEYPAIR_PATH.trim()), 'utf8'));
  } else if (process.env.KOL_WALLET_PRIVATE_KEY?.trim()) {
    secret = parseSecret(process.env.KOL_WALLET_PRIVATE_KEY);
  } else {
    throw new Error('No KOL wallet configured');
  }
  if (secret.length !== 64) throw new Error('KOL wallet secret has an invalid length');
  const k = Keypair.fromSecretKey(Uint8Array.from(secret));
  secret.fill(0);
  const want = process.env.KOL_WALLET_ADDRESS?.trim();
  if (want && k.publicKey.toBase58() !== want) throw new Error('KOL wallet key does not match KOL_WALLET_ADDRESS');
  kolKp = k;
  return kolKp;
}
export function getKolPublicKey(): string | null { try { return loadKolKeypair().publicKey.toBase58(); } catch { return null; } }

/** Internal: returns the signing keypair for the current wallet context. Only the executor should call this. */
export function loadTradingKeypair(): Keypair {
  if (walletCtx.getStore() === 'kol') return loadKolKeypair();
  return loadOperatorKeypair();
}

/** Internal: the operator (main strategy) keypair, regardless of wallet context (profit sweep, withdrawals). */
export function loadOperatorKeypair(): Keypair {
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
  // @solana/web3.js Keypair.fromSecretKey keeps a reference to the given
  // Uint8Array, so pass a copy and zero only the original buffer.
  kp = Keypair.fromSecretKey(Uint8Array.from(secret));
  secret.fill(0);
  return kp;
}

/** Drop the cached keypair so the next load re-reads env. Tests only. */
export function resetTradingKeypairCache(): void {
  kp = null;
  kolKp = null;
}

/** Public address of the operator wallet, or null if none is configured / readable. */
export function getOperatorPublicKey(): string | null {
  try {
    return loadTradingKeypair().publicKey.toBase58();
  } catch {
    return null;
  }
}

/** Operator wallet address regardless of wallet context. */
export function getOperatorWalletAddress(): string | null {
  try {
    return loadOperatorKeypair().publicKey.toBase58();
  } catch {
    return null;
  }
}
