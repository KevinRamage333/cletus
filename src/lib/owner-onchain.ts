/**
 * On-chain fallback for the owner dashboard. Works on Vercel with only a Helius
 * (or other) RPC — no box Postgres required. Used when the worker snapshot is
 * missing or stale, and always as a live check on SOL balance.
 */
import { walletBalances } from './balances';
import { fetchSolPriceUsd } from './dexscreener';
import { solscanTxUrl, solscanAccountUrl } from './approvals';
import { OWNER_TRADING_WALLET } from './owner-plan';
import { rpcCall } from './rpc-pool';
import { getConfig } from './config';

export interface OnchainTx {
  signature: string;
  at: string | null;
  err: boolean;
  solscan: string | null;
}

export interface OnchainWalletView {
  address: string;
  sol: number | null;
  usdc: number | null;
  solPriceUsd: number;
  equityUsd: number | null;
  error: string | null;
  recent: OnchainTx[];
  solscan: string | null;
}

export async function readOnchainWallet(address = OWNER_TRADING_WALLET, limit = 20): Promise<OnchainWalletView> {
  const c = getConfig();
  const [bal, solPrice, sigs] = await Promise.all([
    walletBalances(address),
    fetchSolPriceUsd(c.solPriceFallbackUsd).catch(() => c.solPriceFallbackUsd),
    listRecentSignatures(address, limit).catch(() => [] as OnchainTx[]),
  ]);
  const sol = bal.sol;
  const equityUsd = sol !== null ? Math.round((sol * solPrice + (bal.usdc ?? 0)) * 100) / 100 : null;
  return {
    address,
    sol,
    usdc: bal.usdc,
    solPriceUsd: solPrice,
    equityUsd,
    error: bal.error,
    recent: sigs,
    solscan: solscanAccountUrl(address),
  };
}

async function listRecentSignatures(address: string, limit: number): Promise<OnchainTx[]> {
  const rows = await rpcCall<Array<{ signature: string; blockTime?: number | null; err?: unknown }>>('getSignaturesForAddress', [address, { limit }]);
  return (rows ?? []).map((r) => ({
    signature: r.signature,
    at: r.blockTime ? new Date(r.blockTime * 1000).toISOString() : null,
    err: Boolean(r.err),
    solscan: solscanTxUrl(r.signature),
  }));
}
