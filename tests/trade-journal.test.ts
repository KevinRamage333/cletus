import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendJournal, readJournal, readJournalTrades, slippagePct, excursions, noteLow, takeLow, type JournalEntryEvent, type JournalExitEvent } from '@/lib/trade-journal';
import { closedTradeIc } from '@/lib/retrain/core';
import { rankCandidates } from '@/lib/signals';

const entry = (id: string, extra: Partial<JournalEntryEvent> = {}): JournalEntryEvent => ({
  event: 'entry', v: 1, at: '2026-11-11T20:00:00Z', positionId: id, accountId: 'a', book: 'live', labPreset: null, symbol: 'X', mint: 'm',
  score: 0.66, threshold: 0.6, weightSet: 'liquidity', liquidityWeights: null, signals: { momentum: 0.2 },
  terms: { liquidityBuild: 0.8, velocitySurge: 0.4, volumePersistence: 0.5, freshness: 0.6, antiChase: 0.8, dipInUptrend: 0 },
  mcapUsd: 300000, liquidityUsd: 80000, volume24hUsd: 500000, ageHours: 30, priceChangeH1: 2, priceChangeH24: -10, volPctPerHour: 12,
  regime: { label: 'neutral', medianH1: 0, breadth: 0.5, n: 20 }, sizeUsd: 6, feesUsd: 0.01, quotePrice: 1, fillPrice: 1.01, entrySlippagePct: 1, exitPlan: { stopLossPct: 20 }, ...extra,
});
const exit = (id: string, pnlPct: number): JournalExitEvent => ({
  event: 'exit', v: 1, at: '2026-11-11T21:00:00Z', positionId: id, book: 'live', symbol: 'X', reason: 'stop_loss', holdMin: 60, mfePct: 1, maePct: 10,
  feesUsd: 0.02, observedPrice: 0.9, exitPrice: 0.88, exitSlippagePct: 2.2, costUsd: 6, pnlUsd: (6 * pnlPct) / 100, pnlPct, partialsTaken: 0, partialPnlUsd: 0,
});

describe('trade journal', () => {
  let dir: string; let file: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-')); file = path.join(dir, 'j.jsonl'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.TRADE_JOURNAL; });

  it('appends and joins entry + exit by positionId, skipping torn lines', () => {
    appendJournal(entry('p1'), file); appendJournal(entry('p2'), file); appendJournal(exit('p1', -12), file);
    fs.appendFileSync(file, '{"event":"exit","posit\n');
    const ev = readJournal(file);
    expect(ev).toHaveLength(3);
    const t = readJournalTrades(ev);
    expect(t.find((x) => x.entry.positionId === 'p1')!.exit!.pnlPct).toBe(-12);
    expect(t.find((x) => x.entry.positionId === 'p2')!.exit).toBeNull();
    expect(Object.keys(t[0].entry.terms!)).toHaveLength(6);
  });
  it('never throws on an unwritable path', () => {
    fs.writeFileSync(file, 'x'); // a regular file used as a directory -> ENOTDIR
    expect(appendJournal(entry('p'), path.join(file, 'sub', 'here.jsonl'))).toBe(false);
    expect(readJournal('/nope/missing.jsonl')).toEqual([]);
  });
  it('slippage sign: positive means worse for us', () => {
    expect(slippagePct('buy', 1, 1.02)).toBeCloseTo(2);
    expect(slippagePct('sell', 1, 0.97)).toBeCloseTo(3);
    expect(slippagePct('sell', 0, 1)).toBeNull();
  });
  it('excursions from high/low/exit', () => {
    expect(excursions(1, 1.2, 0.9, 1)).toEqual({ mfePct: 20, maePct: 10 });
    expect(excursions(1, 1, 1, 0.8)).toEqual({ mfePct: 0, maePct: 20 });
  });
  it('noteLow only records with the flag on', () => {
    noteLow('q', 1); expect(takeLow('q')).toBeUndefined();
    process.env.TRADE_JOURNAL = 'on'; noteLow('q', 1); noteLow('q', 0.8); noteLow('q', 0.9);
    expect(takeLow('q')).toBe(0.8); expect(takeLow('q')).toBeUndefined();
  });
});

describe('retrain IC with journaled 6-term trades', () => {
  const w = { liquidityBuild: 0.4, velocitySurge: 0.15, volumePersistence: 0.1, freshness: 0.15, antiChase: 0.15, dipInUptrend: 0.05 };
  it('uses the full score when every trade has all terms', () => {
    const mk = (f: number, pnl: number) => ({ liquidityBuild: 0.5, velocitySurge: 0.5, momentum: 0.5, pnlPct: pnl, terms: { liquidityBuild: 0.5, velocitySurge: 0.5, volumePersistence: 0.5, freshness: f, antiChase: 0.5, dipInUptrend: 0.5 } });
    // Partial (3-term) score is constant -> null IC; the full score ranks by freshness -> +1.
    expect(closedTradeIc(w, [mk(0.1, -5), mk(0.5, 0), mk(0.9, 5)])).toBe(1);
    const partial = [mk(0.1, -5), mk(0.5, 0), { liquidityBuild: 0.5, velocitySurge: 0.5, momentum: 0.5, pnlPct: 5 }];
    expect(closedTradeIc(w, partial)).toBeNull();
  });
});

describe('scan candidates carry the 6 terms', () => {
  it('rankCandidates attaches terms', () => {
    const now = Date.now();
    const pair = { chainId: 'solana', dexId: 'raydium', pairAddress: 'P', url: '', baseToken: { address: 'M', symbol: 'S', name: 'S' }, quoteToken: { address: 'Q', symbol: 'SOL', name: 'SOL' }, priceUsd: '0.001', marketCap: 500000, fdv: 500000, liquidity: { usd: 90000 }, volume: { h24: 400000, h6: 100000, h1: 20000, m5: 2000 }, priceChange: { m5: 1, h1: 2, h6: 5, h24: 10 }, txns: { m5: { buys: 10, sells: 5 }, h1: { buys: 100, sells: 80 }, h6: { buys: 500, sells: 400 }, h24: { buys: 2000, sells: 1800 } }, pairCreatedAt: now - 48 * 3_600_000 };
    const [c] = rankCandidates([pair as never], { minMarketCap: 70000, maxMarketCap: 5e6, minVolume24hUsd: 0, minTokenAgeHours: 0, maxHourlyPriceMovement: 100, nanoCapMax: 100000, signalWeightSet: 'liquidity' }, {} as never, now);
    expect(Object.keys(c.terms!).sort()).toEqual(['antiChase', 'dipInUptrend', 'freshness', 'liquidityBuild', 'velocitySurge', 'volumePersistence']);
  });
});
