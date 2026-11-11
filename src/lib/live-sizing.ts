/**
 * Where trade sizing gets its equity/cash from.
 *
 * Paper/simulation accounts size from the Postgres book. A LIVE operator trade
 * spends real SOL from the on-chain trading wallet, so it must size strictly
 * from that wallet. There is deliberately no fallback to the paper book: if the
 * on-chain balance cannot be read, the trade is skipped.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;

export interface SizingBalances {
  equityUsd: number;
  cashUsd: number;
  source: 'book' | 'onchain';
}

export type SizingBalanceResult = ({ ok: true } & SizingBalances) | { ok: false; reason: string };

export interface ResolveSizingInput {
  /** True when this entry would execute a real on-chain swap (live mode, operator account). */
  live: boolean;
  /** Paper book values from Postgres. Used only when live is false. */
  bookEquityUsd: number;
  bookCashUsd: number;
  /** Mark-to-market value of open LIVE (non-simulated) positions. */
  liveOpenValueUsd?: number;
  /** Current SOL/USD price. Must be > 0 in live mode. */
  solPriceUsd: number;
  /** Reads the trading wallet's SOL balance in lamports; null when the wallet key is not loaded. */
  getLamports: () => Promise<number | bigint | null>;
}

export async function resolveSizingBalances(i: ResolveSizingInput): Promise<SizingBalanceResult> {
  if (!i.live) return { ok: true, equityUsd: i.bookEquityUsd, cashUsd: i.bookCashUsd, source: 'book' };
  const solPrice = Number(i.solPriceUsd);
  if (!Number.isFinite(solPrice) || solPrice <= 0) return { ok: false, reason: 'no live SOL price' };
  let lamports: number | bigint | null;
  try {
    lamports = await i.getLamports();
  } catch (e) {
    return { ok: false, reason: `balance read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (lamports === null || lamports === undefined) return { ok: false, reason: 'trading wallet key not loaded' };
  const lam = Number(lamports);
  if (!Number.isFinite(lam) || lam < 0) return { ok: false, reason: `invalid balance ${String(lamports)}` };
  const cashUsd = (lam / LAMPORTS_PER_SOL) * solPrice;
  const openValue = Math.max(0, Number(i.liveOpenValueUsd) || 0);
  return { ok: true, cashUsd, equityUsd: cashUsd + openValue, source: 'onchain' };
}
