/**
 * Simulation fills from real Jupiter Swap API V2 quotes (GET /order WITHOUT a taker: quote only, nothing signable).
 * Uses the quote's priceImpactPct and feeBps (incl. the 50 bps new-token fee). If the Jupiter bucket is busy or the
 * call fails, falls back to the constant-product model in fills.ts with the expected fee for the token's age.
 */
import { simFillPrice } from './fills';
import { expectedFeeBps, SOL_MINT } from './jupiter';

export interface SimFill { fillPrice: number; feeBps: number; source: 'jupiter' | 'model'; router?: string; impactPct?: number }
const feeMemo = new Map<string, number>();            // mint -> last seen feeBps (so exits use the entry-time fee class)
const decimalsMemo = new Map<string, number>();
export const rememberFee = (mint: string, bps: number) => feeMemo.set(mint, bps);
export const knownFee = (mint: string, ageHours?: number | null) => feeMemo.get(mint) ?? expectedFeeBps(ageHours ?? null);

/** Pure: apply a quote's impact to the mid price. */
export function fillFromQuote(side: 'buy' | 'sell', mid: number, impactFraction: number): number {
  const i = Math.min(0.99, Math.max(0, impactFraction));
  return side === 'buy' ? mid * (1 + i) : mid * (1 - i);
}
/** Pure: simulated fees = Jupiter fee on the notional + network/priority fee. */
export function simFeesUsd(notionalUsd: number, feeBps: number, priorityLamports: number, solPriceUsd: number): number {
  return (notionalUsd * feeBps) / 10_000 + (priorityLamports / 1e9) * solPriceUsd;
}

async function decimals(mint: string): Promise<number | null> {
  if (decimalsMemo.has(mint)) return decimalsMemo.get(mint)!;
  try {
    const { rpcCall } = await import('./rpc-pool');
    const r = await rpcCall<{ value: { decimals: number } }>('getTokenSupply', [mint], { timeoutMs: 4000 });
    decimalsMemo.set(mint, r.value.decimals); return r.value.decimals;
  } catch { return null; }
}

export async function simBuy(o: { mint: string; sizeUsd: number; mid: number; solPriceUsd: number; liquidityUsd?: number | null; fallbackImpact: number; ageHours?: number | null; maxWaitMs?: number }): Promise<SimFill> {
  const model = (): SimFill => ({ fillPrice: simFillPrice('buy', o.mid, o.sizeUsd, o.liquidityUsd, o.fallbackImpact), feeBps: knownFee(o.mint, o.ageHours), source: 'model' });
  if (process.env.SIM_JUPITER_QUOTES === 'off' || !(o.solPriceUsd > 0) || !(o.mid > 0)) return model();
  try {
    const { getOrder } = await import('./jupiter');
    const lamports = BigInt(Math.max(1, Math.round((o.sizeUsd / o.solPriceUsd) * 1e9)));
    const q = await getOrder({ inputMint: SOL_MINT, outputMint: o.mint, amount: lamports }, { maxWaitMs: o.maxWaitMs ?? 2500 });
    if (!(Number(q.outAmount) > 0)) return model();
    rememberFee(o.mint, q.feeBps);
    return { fillPrice: fillFromQuote('buy', o.mid, q.priceImpactPct), feeBps: q.feeBps, source: 'jupiter', router: q.router, impactPct: q.priceImpactPct * 100 };
  } catch { return model(); }
}

export async function simSell(o: { mint: string; tokenAmount: number; mid: number; liquidityUsd?: number | null; fallbackImpact: number; maxWaitMs?: number }): Promise<SimFill> {
  const notional = o.tokenAmount * o.mid;
  const model = (): SimFill => ({ fillPrice: simFillPrice('sell', o.mid, notional, o.liquidityUsd, o.fallbackImpact), feeBps: knownFee(o.mint), source: 'model' });
  if (process.env.SIM_JUPITER_QUOTES === 'off' || !(o.mid > 0) || !(o.tokenAmount > 0)) return model();
  try {
    const d = await decimals(o.mint);
    if (d === null) return model();
    const { getOrder } = await import('./jupiter');
    const raw = BigInt(Math.max(1, Math.floor(o.tokenAmount * 10 ** d)));
    const q = await getOrder({ inputMint: o.mint, outputMint: SOL_MINT, amount: raw }, { maxWaitMs: o.maxWaitMs ?? 2500 });
    if (!(Number(q.outAmount) > 0)) return model();
    rememberFee(o.mint, q.feeBps);
    return { fillPrice: fillFromQuote('sell', o.mid, q.priceImpactPct), feeBps: q.feeBps, source: 'jupiter', router: q.router, impactPct: q.priceImpactPct * 100 };
  } catch { return model(); }
}
