/**
 * Solana address validation (browser-safe: no node:crypto).
 * Used by the owner money plan and by owner-only withdrawals.
 */
import { PublicKey } from '@solana/web3.js';

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Addresses you must never send funds to: programs and mints (unrecoverable). */
export const BLOCKED_DESTINATIONS = new Set([
  '11111111111111111111111111111111',                       // System Program
  'So11111111111111111111111111111111111111112',            // wrapped SOL mint
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',           // USDC mint
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',            // SPL Token program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',            // Token-2022 program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',           // Associated Token program
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',            // Jupiter v6
  'Sysvar1nstructions1111111111111111111111111',
  'SysvarRent111111111111111111111111111111111',
  'SysvarC1ock11111111111111111111111111111111',
]);

export type DestResult = { ok: true; address: string } | { ok: false; error: string };

export function validateDestination(input: unknown, ownAddress: string | null): DestResult {
  const s = String(input ?? '').trim();
  if (!s) return { ok: false, error: 'Enter a Solana address' };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return { ok: false, error: 'That is not a valid Solana address (base58, 32–44 characters)' };
  let pk: PublicKey;
  try { pk = new PublicKey(s); } catch { return { ok: false, error: 'That is not a valid Solana address' }; }
  const addr = pk.toBase58();
  if (addr !== s) return { ok: false, error: 'Address did not round-trip; check for typos' };
  if (BLOCKED_DESTINATIONS.has(addr)) return { ok: false, error: 'That is a program or token mint address, not a wallet. Funds sent there are lost.' };
  if (ownAddress && addr === ownAddress) return { ok: false, error: 'That is the trading wallet itself' };
  if (!PublicKey.isOnCurve(pk.toBytes())) return { ok: false, error: 'That address is off-curve (a program-derived account), not a normal wallet' };
  return { ok: true, address: addr };
}
