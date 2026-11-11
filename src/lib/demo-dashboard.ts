/**
 * Sample portfolio used by the public demo dashboard (no accounts, no database).
 * Numbers are illustrative paper results, not live performance and not a promise of returns.
 */
import { DEFAULT_OPERATOR_FEE_BPS } from './jupiter';
import { operatorFeeUsd, tradeFeeView, expiresAtFrom, type ApprovalRecord } from './approvals';

export const DEMO_STARTING_BALANCE = 10_000;

export interface DemoPosition {
  id: string;
  symbol: string;
  mint: string;
  sizeUsd: number;
  entryPrice: number;
  lastPrice: number;
  tokenAmount: number;
  feesUsd: number;
  pnlUsd: number;
  pnlPct: number;
  openedAt: string;
  simulated: boolean;
  entryTx: string | null;
}

export interface DemoTrade {
  id: string;
  symbol: string;
  mint: string;
  side: 'buy' | 'sell';
  sizeUsd: number;
  entryPrice: number;
  exitPrice: number;
  pnlUsd: number;
  pnlPct: number;
  feesUsd: number;
  operatorFeeBps: number;
  operatorFeeUsd: number;
  exitReason: string;
  openedAt: string;
  closedAt: string;
  simulated: boolean;
  entryTx: string | null;
  exitTx: string | null;
}

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
const POPCAT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
const MEW = 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5';

function ago(hours: number, extraMin = 0) {
  return new Date(Date.now() - hours * 3600_000 - extraMin * 60_000).toISOString();
}

export function demoPositions(): DemoPosition[] {
  return [
    pos('p1', 'BONK', BONK, 250, 0.0000214, 0.0000228, 14, 2.1),
    pos('p2', 'WIF', WIF, 180, 1.42, 1.35, 8, -1.4),
  ];
}

function pos(id: string, symbol: string, mint: string, sizeUsd: number, entry: number, last: number, hoursAgo: number, feePad: number): DemoPosition {
  const tokenAmount = sizeUsd / entry;
  const feesUsd = operatorFeeUsd(sizeUsd) + feePad * 0.01;
  const pnlUsd = tokenAmount * last - sizeUsd - feesUsd;
  return {
    id, symbol, mint, sizeUsd, entryPrice: entry, lastPrice: last, tokenAmount, feesUsd,
    pnlUsd, pnlPct: (last / entry - 1) * 100, openedAt: ago(hoursAgo), simulated: true, entryTx: null,
  };
}

export function demoTrades(): DemoTrade[] {
  const rows: Array<[string, string, string, number, number, number, string, number, number]> = [
    ['t1', 'POPCAT', POPCAT, 200, 0.62, 0.71, 'take_profit', 18, 40],
    ['t2', 'MEW', MEW, 150, 0.0084, 0.0079, 'stop_loss', 12, 25],
    ['t3', 'BONK', BONK, 220, 0.0000198, 0.0000211, 'partial_then_exit', 30, 10],
    ['t4', 'WIF', WIF, 175, 1.55, 1.48, 'stale_exit', 40, 8],
    ['t5', 'POPCAT', POPCAT, 160, 0.58, 0.57, 'stop_loss', 50, 6],
  ];
  return rows.map(([id, symbol, mint, sizeUsd, entry, exit, reason, openH, heldH]) => {
    const tokenAmount = sizeUsd / entry;
    const fees = tradeFeeView({ sizeUsd, feesUsd: 0, tokenAmount, exitPrice: exit });
    const feesUsd = fees.operatorFeeUsd + 0.04;
    const pnlUsd = tokenAmount * exit - sizeUsd - feesUsd;
    return {
      id, symbol, mint, side: 'sell' as const, sizeUsd, entryPrice: entry, exitPrice: exit,
      pnlUsd, pnlPct: (pnlUsd / sizeUsd) * 100, feesUsd,
      operatorFeeBps: DEFAULT_OPERATOR_FEE_BPS, operatorFeeUsd: fees.operatorFeeUsd,
      exitReason: reason, openedAt: ago(openH + heldH), closedAt: ago(openH),
      simulated: true, entryTx: null, exitTx: null,
    };
  });
}

export function demoApprovals(now = Date.now()): ApprovalRecord[] {
  const sizeUsd = 200;
  return [{
    id: 'demo-pending-1',
    status: 'pending',
    side: 'buy',
    mint: BONK,
    symbol: 'BONK',
    sizeUsd,
    expiresAt: expiresAtFrom(now, 45_000).toISOString(),
    operatorFeeBps: DEFAULT_OPERATOR_FEE_BPS,
    operatorFeeUsd: operatorFeeUsd(sizeUsd),
    feeUsd: operatorFeeUsd(sizeUsd) + 0.03,
    signature: null,
    requestId: 'demo',
    transaction: 'demo-preview',
    reason: 'Volume spike + buy pressure (score 0.81). Preview only — public demo cannot submit a swap.',
    score: 0.81,
    priceImpactPct: 0.42,
  }];
}

export function demoPortfolio() {
  const open = demoPositions();
  const closed = demoTrades();
  const unrealized = open.reduce((s, p) => s + p.pnlUsd, 0);
  const realized = closed.reduce((s, t) => s + t.pnlUsd, 0);
  const wins = closed.filter((t) => t.pnlUsd > 0).length;
  return {
    mode: 'paper' as const,
    startingBalance: DEMO_STARTING_BALANCE,
    equity: DEMO_STARTING_BALANCE + realized + unrealized,
    cash: DEMO_STARTING_BALANCE - open.reduce((s, p) => s + p.sizeUsd + p.feesUsd, 0) + realized,
    realizedPnl: realized,
    unrealizedPnl: unrealized,
    totalPnl: realized + unrealized,
    winRate: closed.length ? wins / closed.length : null,
    closedTrades: closed.length,
    open,
    closed,
    approvals: demoApprovals(),
    operatorFeeBps: DEFAULT_OPERATOR_FEE_BPS,
    wallet: { address: null as string | null, source: 'paper' as const, connected: false },
  };
}
