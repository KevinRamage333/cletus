import { describe, it, expect } from 'vitest';
import { hardRiskBlock, capByEquityPct, lossStreakPause } from '@/lib/risk';
import { exitDecision, parseTpLadder, partialTakeProfit, effectiveStopLossPct, HARD_STOP_CEILING_PCT, preferStopOverSecondary } from '@/lib/exits';
import { computeScorecard } from '@/lib/scorecard';
import { submissionPlan, parseSubmissionMode } from '@/lib/submission';
import { simFillPrice } from '@/lib/fills';
import { evaluateAudit } from '@/lib/audit';

const RP = { dailyLossLimitUsd: -300, maxDailyLossPct: 5, maxPositionPctOfEquity: 5, maxConsecutiveLosses: 4 };

describe('hard risk limits', () => {
  it('blocks on daily USD loss, % loss and loss streak', () => {
    expect(hardRiskBlock({ dayPnlUsd: -301, equityUsd: 10000, consecutiveLosses: 0 }, RP)).toMatch(/daily loss/);
    expect(hardRiskBlock({ dayPnlUsd: -250, equityUsd: 4750, consecutiveLosses: 0 }, RP)).toMatch(/5% of equity/);
    expect(hardRiskBlock({ dayPnlUsd: 0, equityUsd: 10000, consecutiveLosses: 4 }, RP)).toMatch(/losses in a row/);
    expect(hardRiskBlock({ dayPnlUsd: -50, equityUsd: 10000, consecutiveLosses: 3 }, RP)).toBeNull();
  });
  it('caps size by % of equity and pauses after N losses', () => {
    expect(capByEquityPct(2000, 10000, 5)).toEqual({ sizeUsd: 500, capped: true });
    expect(capByEquityPct(200, 10000, 5).capped).toBe(false);
    expect(lossStreakPause(4, 4)).toBe(true);
    expect(lossStreakPause(3, 4)).toBe(false);
    expect(lossStreakPause(9, 0)).toBe(false);
  });
});

describe('exits', () => {
  const now = new Date();
  const P = { stopLossPct: 5, takeProfitPct: 25, breakEvenTriggerPct: 5, enableTrailingStop: true, trailingStopPct: 5, holdTimeMinutes: 120, stalePositionMinutes: 45, staleBandPct: 2 };
  it('stale exit after N minutes inside the band, but not when moving', () => {
    const old = { entryPrice: 1, highestPrice: 1.01, openedAt: new Date(now.getTime() - 50 * 60_000) };
    expect(exitDecision(old, 1.01, P, now)).toBe('stale_exit');
    expect(exitDecision(old, 1.04, P, now)).toBeNull();
    expect(exitDecision({ ...old, openedAt: new Date(now.getTime() - 10 * 60_000) }, 1.01, P, now)).toBeNull();
  });
  it('trailing stop still fires', () => {
    expect(exitDecision({ entryPrice: 1, highestPrice: 1.2, openedAt: now }, 1.13, P, now)).toBe('trailing_stop');
  });
  it('partial take-profit ladder', () => {
    const L = parseTpLadder('18:50, 10:33, bad, 5:0');
    expect(L).toEqual([{ gainPct: 10, sellPct: 33 }, { gainPct: 18, sellPct: 50 }]);
    expect(partialTakeProfit({ entryPrice: 1 }, 1.05, L, 0, 25)).toBeNull();
    expect(partialTakeProfit({ entryPrice: 1 }, 1.11, L, 0, 25)).toMatchObject({ rung: 1, fraction: 0.33 });
    expect(partialTakeProfit({ entryPrice: 1 }, 1.11, L, 1, 25)).toBeNull();
    expect(partialTakeProfit({ entryPrice: 1 }, 1.2, L, 1, 25)).toMatchObject({ rung: 2, fraction: 0.5 });
    expect(partialTakeProfit({ entryPrice: 1 }, 1.3, L, 0, 25)).toBeNull(); // full TP handles it
  });
});

describe('realistic simulated fills', () => {
  it('applies constant-product impact on both sides', () => {
    expect(simFillPrice('buy', 1, 1000, 100000)).toBeCloseTo(1.02, 6);
    expect(simFillPrice('sell', 1, 1000, 100000)).toBeCloseTo(50000 / 51000, 6);
    expect(simFillPrice('sell', 0.9, 1000, null, 0.01)).toBeCloseTo(0.891, 6);
  });
});

describe('scorecard', () => {
  it('computes win rate, avg win/loss, drawdown and Sharpe', () => {
    const t0 = Date.now();
    const s = computeScorecard([
      { pnlUsd: 100, pnlPct: 10, closedAt: new Date(t0) },
      { pnlUsd: -50, pnlPct: -5, closedAt: new Date(t0 + 1000) },
      { pnlUsd: -50, pnlPct: -5, closedAt: new Date(t0 + 2000) },
      { pnlUsd: 200, pnlPct: 20, closedAt: new Date(t0 + 3000) },
    ], 1000);
    expect(s.winRate).toBe(0.5);
    expect(s.avgWinUsd).toBe(150);
    expect(s.avgLossUsd).toBe(-50);
    expect(s.payoffRatio).toBe(3);
    expect(s.profitFactor).toBe(3);
    expect(s.maxDrawdownUsd).toBe(100);
    expect(s.maxDrawdownPct).toBeCloseTo(100 / 1100 * 100, 6);
    expect(s.sharpePerTrade).toBeGreaterThan(0);
    expect(computeScorecard([], 1000).winRate).toBeNull();
  });
});

describe('swap submission path', () => {
  const base = { privateRpcUrl: null, jitoBlockEngineUrl: 'https://mainnet.block-engine.jito.wtf/', jitoTipLamports: 10000, rpcUrl: 'https://rpc.example' };
  it('standard by default, jito with tip, private rpc with fallback', () => {
    expect(parseSubmissionMode(undefined)).toBe('standard');
    expect(parseSubmissionMode('JITO')).toBe('jito');
    expect(submissionPlan({ ...base, submissionMode: 'standard' }, 5000)).toMatchObject({ mode: 'standard', sendUrl: 'https://rpc.example', prioritization: 5000 });
    expect(submissionPlan({ ...base, submissionMode: 'jito' }, 5000)).toMatchObject({ mode: 'jito', sendUrl: 'https://mainnet.block-engine.jito.wtf/api/v1/transactions', prioritization: { jitoTipLamports: 10000 } });
    expect(submissionPlan({ ...base, submissionMode: 'private_rpc' }, 5000).mode).toBe('standard');
    expect(submissionPlan({ ...base, submissionMode: 'private_rpc', privateRpcUrl: 'https://priv' }, 5000)).toMatchObject({ mode: 'private_rpc', sendUrl: 'https://priv' });
  });
});

describe('extra pre-trade checks', () => {
  const P = { maxHolderConcentration: 0.3, requireLiquidityLock: true, minLpLockedPct: 80, maxAuditRiskScore: 69, maxSellPriceImpactPct: 25, maxTop10HolderPct: 30, devSellCheck: true, blockIfDevExited: true, devExitLookbackHours: 24 };
  const sell = { routeFound: true, priceImpactPct: 1 };
  const base = { mintAuthority: null, freezeAuthority: null, rugged: false, transferFee: { pct: 0 }, risks: [], markets: [{ lp: { lpLockedPct: 100 } }], topHolders: Array.from({ length: 10 }, (_, i) => ({ address: `holder-${i}`, pct: 2 })), score_normalised: 10 };
  it('passes a clean token', () => {
    expect(evaluateAudit(base, sell, P).passed).toBe(true);
  });
  it('fails top-10 concentration, LP lock, dev selling', () => {
    const conc = evaluateAudit({ ...base, topHolders: Array.from({ length: 10 }, (_, i) => ({ address: `h${i}`, pct: 4 })) }, sell, P);
    expect(conc.checks.find((c) => c.name === 'top10_concentration')?.passed).toBe(false);
    expect(evaluateAudit({ ...base, markets: [{ lp: { lpLockedPct: 10 } }] }, sell, P).checks.find((c) => c.name === 'lp_locked')?.passed).toBe(false);
    expect(evaluateAudit({ ...base, risks: [{ name: 'Creator sold tokens', level: 'warn' }] }, sell, P).checks.find((c) => c.name === 'dev_selling')?.passed).toBe(false);
    const young = evaluateAudit({ ...base, creator: 'Dev1', creatorBalance: 0, detectedAt: new Date(Date.now() - 3600_000).toISOString() }, sell, P);
    expect(young.checks.find((c) => c.name === 'dev_selling')?.passed).toBe(false);
    expect(young.creator).toBe('Dev1');
  });
});

describe('hard stop ceiling and stop priority', () => {
  const now = new Date();
  const base = { takeProfitPct: 50, breakEvenTriggerPct: 5, enableTrailingStop: false, trailingStopPct: 5, holdTimeMinutes: 120 };
  const pos = { entryPrice: 1, highestPrice: 1, openedAt: now };

  it('effective stop is the tighter of the plan stop and the 20% hard ceiling', () => {
    expect(effectiveStopLossPct(7, HARD_STOP_CEILING_PCT)).toBe(7);
    expect(effectiveStopLossPct(25, HARD_STOP_CEILING_PCT)).toBe(20);
    expect(effectiveStopLossPct(20, 20)).toBe(20);
    expect(effectiveStopLossPct(0, 20)).toBe(20);
  });

  it('a 25% dynamic stop still sells at -20% because of the hard ceiling', () => {
    const p = { ...base, stopLossPct: 25 };
    expect(exitDecision(pos, 0.79, p, now)).toBe('stop_loss'); // -21%
    expect(exitDecision(pos, 0.79, { ...p, hardStopCeilingPct: 20 }, now)).toBe('stop_loss');
    expect(exitDecision(pos, 0.82, p, now)).toBeNull(); // -18% — under a 20% ceiling
  });

  it('a KOL 7% stop still fires at -7%, not only at the 20% ceiling', () => {
    const p = { ...base, stopLossPct: 7, hardStopCeilingPct: 20 };
    expect(exitDecision(pos, 0.92, p, now)).toBe('stop_loss'); // -8%
    expect(exitDecision(pos, 0.94, p, now)).toBeNull(); // -6%
  });

  it('a breached stop is chosen over a low-volume / fade exit', () => {
    expect(preferStopOverSecondary('stop_loss', 'low_volume_5m')).toBe('stop_loss');
    expect(preferStopOverSecondary(null, 'low_volume_5m')).toBe('low_volume_5m');
    expect(preferStopOverSecondary('take_profit', 'volume_fade')).toBe('take_profit');
    expect(preferStopOverSecondary(null, null)).toBeNull();
  });
});
