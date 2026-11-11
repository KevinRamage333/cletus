import { PublicKey } from '@solana/web3.js';

export type Validation = { ok: true } | { ok: false; error: string };

export function validateTermsAcceptance(body: unknown, currentVersion: string): Validation {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.version !== currentVersion) return { ok: false, error: `terms version mismatch (current is ${currentVersion}); reload and read the current terms` };
  if (b.scrolledToEnd !== true) return { ok: false, error: 'you must scroll to the end of the Terms and Conditions' };
  if (b.readConfirmed !== true) return { ok: false, error: 'you must confirm you have read the entire Terms and Conditions' };
  return { ok: true };
}

export function validateRiskAck(body: unknown, currentVersion: string, termsAcceptedVersion: string | null): Validation {
  const b = (body ?? {}) as Record<string, unknown>;
  if (termsAcceptedVersion !== currentVersion) return { ok: false, error: 'accept the current Terms and Conditions first' };
  if (b.version !== currentVersion) return { ok: false, error: 'risk disclaimer version mismatch; reload' };
  if (b.acknowledged !== true) return { ok: false, error: 'you must acknowledge the risk disclaimer' };
  return { ok: true };
}

export const WALLET_SOURCES = ['connected', 'paper'] as const;
export type WalletSource = (typeof WALLET_SOURCES)[number];

const SECRET_FIELDS = ['secretKey', 'mnemonic', 'privateKey', 'seed', 'recoveryPhrase', 'secret'];

/** Non-custodial wallet step: connect an existing wallet (SIWS) or continue in paper mode. Secrets are always rejected. */
export function validateWalletSetup(body: unknown, termsOk: boolean, riskOk: boolean): Validation & { publicKey?: string; source?: WalletSource } {
  if (!termsOk || !riskOk) return { ok: false, error: 'complete the Terms and Risk Disclaimer steps first' };
  const b = (body ?? {}) as Record<string, unknown>;
  if (SECRET_FIELDS.some((k) => k in b)) return { ok: false, error: 'only the public key may be sent to the server' };
  if (b.source === 'created' || b.source === 'imported') {
    return { ok: false, error: 'Cletus does not create or import wallets. Connect your own wallet or continue in paper mode.' };
  }
  if (b.source === 'paper') return { ok: true, source: 'paper' };
  if (b.source !== 'connected') return { ok: false, error: 'source must be "connected" or "paper"' };
  if (typeof b.publicKey !== 'string') return { ok: false, error: 'publicKey required' };
  if (b.publicKey.length > 44) return { ok: false, error: 'only the public key may be sent to the server' };
  try {
    const pk = new PublicKey(b.publicKey);
    if (pk.toBase58() !== b.publicKey) throw new Error('non-canonical');
  } catch {
    return { ok: false, error: 'invalid Solana public key' };
  }
  if (typeof b.signature !== 'string' || !b.signature) return { ok: false, error: 'Sign-In-With-Solana signature is required' };
  if (typeof b.message !== 'string' || !b.message) return { ok: false, error: 'Sign-In-With-Solana message is required' };
  if (typeof b.challenge !== 'string' || !b.challenge) return { ok: false, error: 'Sign-In-With-Solana challenge is required' };
  return { ok: true, publicKey: b.publicKey, source: 'connected' };
}

export function validEmail(e: unknown): e is string {
  return typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
