import { describe, it, expect, vi } from 'vitest';
import { resolveSizingBalances } from '@/lib/live-sizing';
import { buildConfig, applyOwnerPlan } from '@/lib/config';
import { computeOwnerTradeSize } from '@/lib/owner-plan';

const SOL = 180;
const PAPER_CASH = 9725;
const ONCHAIN_USD = 9.87;
const lamportsFor = (usd: number) => Math.round((usd / SOL) * 1e9);
const c = applyOwnerPlan(buildConfig({ TRADING_MODE: 'live', OWNER_PLAN_ENABLED: 'true', MCAP_PRESET: 'BALANCED' }), true);

function ownerSize(equityUsd: number, cashUsd: number) {
  return computeOwnerTradeSize(
    { equityUsd, cashUsd, solPriceUsd: SOL, feeReserveSol: c.ownerPlan.feeReserveSol, minTradeUsd: c.minTradeUsd },
    c.ownerPlan.sizeTiers, c.ownerPlan.sizeStepUsd, c.ownerPlan.sizeIncrementUsd,
  ).sizeUsd;
}

describe('live sizing uses the on-chain wallet, never the paper book', () => {
  it('live: paper cash $9,725 + on-chain $9.87 sizes ~$3, not ~$1,947', async () => {
    const r = await resolveSizingBalances({
      live: true, bookEquityUsd: PAPER_CASH, bookCashUsd: PAPER_CASH, solPriceUsd: SOL,
      getLamports: async () => lamportsFor(ONCHAIN_USD),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe('onchain');
    expect(r.cashUsd).toBeCloseTo(ONCHAIN_USD, 2);
    expect(r.equityUsd).toBeCloseTo(ONCHAIN_USD, 2);
    expect(ownerSize(r.equityUsd, r.cashUsd)).toBe(3);
    // Guard: the paper book alone would have produced the dangerous size.
    expect(ownerSize(PAPER_CASH, PAPER_CASH)).toBeGreaterThan(1000);
  });

  it('live: adds only live open-position value to on-chain cash', async () => {
    const r = await resolveSizingBalances({
      live: true, bookEquityUsd: PAPER_CASH + 500, bookCashUsd: PAPER_CASH, liveOpenValueUsd: 3, solPriceUsd: SOL,
      getLamports: async () => BigInt(lamportsFor(ONCHAIN_USD)),
    });
    expect(r.ok && r.equityUsd).toBeCloseTo(ONCHAIN_USD + 3, 2);
  });

  it('live: balance read failure skips (no fallback to paper book)', async () => {
    const r = await resolveSizingBalances({
      live: true, bookEquityUsd: PAPER_CASH, bookCashUsd: PAPER_CASH, solPriceUsd: SOL,
      getLamports: async () => { throw new Error('RPC 429'); },
    });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('RPC 429') });
  });

  it('live: missing wallet key or SOL price skips', async () => {
    expect((await resolveSizingBalances({ live: true, bookEquityUsd: PAPER_CASH, bookCashUsd: PAPER_CASH, solPriceUsd: SOL, getLamports: async () => null })).ok).toBe(false);
    const read = vi.fn(async () => lamportsFor(ONCHAIN_USD));
    expect((await resolveSizingBalances({ live: true, bookEquityUsd: PAPER_CASH, bookCashUsd: PAPER_CASH, solPriceUsd: 0, getLamports: read })).ok).toBe(false);
    expect((await resolveSizingBalances({ live: true, bookEquityUsd: PAPER_CASH, bookCashUsd: PAPER_CASH, solPriceUsd: SOL, getLamports: async () => Number.NaN })).ok).toBe(false);
  });

  it('paper: sizes from the book and never reads the chain', async () => {
    const read = vi.fn(async () => 0);
    const r = await resolveSizingBalances({ live: false, bookEquityUsd: PAPER_CASH, bookCashUsd: PAPER_CASH, solPriceUsd: SOL, getLamports: read });
    expect(r).toEqual({ ok: true, equityUsd: PAPER_CASH, cashUsd: PAPER_CASH, source: 'book' });
    expect(read).not.toHaveBeenCalled();
  });
});
