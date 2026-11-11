/**
 * Owner live-trading money plan for the operator wallet only
 * (GdDBJt1nCibTENMKnGRPoNkjaCskTXwrdF1x1UHgY7Hq).
 *
 * Fixed-dollar progressive sizing by wallet equity, 1 position at a time,
 * 5% stop / 20% take-profit, and a profit-sweep ladder to PAYOUT_WALLET.
 * Pure helpers live here so they can be unit-tested without the DB or chain.
 */
import { LAMPORTS_PER_SOL, validateDestination } from './solana-address';
import { parseTpLadder, type TpRung } from './exits';

/** The server trading wallet. Owner trades from this address are never charged the platform fee. */
export const OWNER_TRADING_WALLET = 'GdDBJt1nCibTENMKnGRPoNkjaCskTXwrdF1x1UHgY7Hq';

export const DEFAULT_FEE_RESERVE_SOL = 0.01;
export const DEFAULT_TRADE_SIZES = { under10: 3, at10: 5, at20: 7 } as const;
export const DEFAULT_SIZE_STEP_USD = 10;
export const DEFAULT_SIZE_INCREMENT_USD = 2;
export const DEFAULT_SWEEP_AMOUNT_USD = 25;
export const DEFAULT_SWEEP_STEP_USD = 50;
export const DEFAULT_SWEEP_FIRST_TARGET_USD = 50;
export const DEFAULT_SWEEP_DAILY_CAP_USD = 50;
export const DEFAULT_OWNER_STOP_LOSS_PCT = 5;
export const DEFAULT_OWNER_TAKE_PROFIT_PCT = 20;
export const DEFAULT_OWNER_MAX_OPEN_POSITIONS = 1;

export interface EquitySizeTier { minEquityUsd: number; sizeUsd: number }

export const DEFAULT_SIZE_TIERS: EquitySizeTier[] = [
  { minEquityUsd: 0, sizeUsd: DEFAULT_TRADE_SIZES.under10 },
  { minEquityUsd: 10, sizeUsd: DEFAULT_TRADE_SIZES.at10 },
  { minEquityUsd: 20, sizeUsd: DEFAULT_TRADE_SIZES.at20 },
];

const optNum = (v: string | undefined): number | null => { if (v === undefined || v.trim() === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const num = (v: string | undefined, d: number) => {
  if (v === undefined || String(v).trim() === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean) =>
  (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));
const str = (v: string | undefined, d = '') => (v === undefined || v.trim() === '' ? d : v.trim());

/** Single place that resolves the operator-fee / partner wallet. PAYOUT_WALLET wins when OPERATOR_FEE_WALLET is unset. */
export function resolveOperatorFeeWallet(
  env: Record<string, string | undefined> = {},
  fallback = OWNER_TRADING_WALLET,
): string {
  const explicit = str(env.OPERATOR_FEE_WALLET);
  if (explicit) return explicit;
  const payout = str(env.PAYOUT_WALLET);
  if (payout) return payout;
  return fallback;
}

export function parseSizeTiers(raw: string | undefined | null, fallback: EquitySizeTier[] = DEFAULT_SIZE_TIERS): EquitySizeTier[] {
  if (!raw || !String(raw).trim()) return fallback.map((t) => ({ ...t }));
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(parsed)) return fallback.map((t) => ({ ...t }));
    const tiers: EquitySizeTier[] = [];
    for (const row of parsed) {
      const minEquityUsd = Number((row as { minEquityUsd?: unknown }).minEquityUsd);
      const sizeUsd = Number((row as { sizeUsd?: unknown }).sizeUsd);
      if (!Number.isFinite(minEquityUsd) || minEquityUsd < 0 || !Number.isFinite(sizeUsd) || sizeUsd <= 0) continue;
      tiers.push({ minEquityUsd, sizeUsd });
    }
    return tiers.length ? tiers.sort((a, b) => a.minEquityUsd - b.minEquityUsd) : fallback.map((t) => ({ ...t }));
  } catch {
    return fallback.map((t) => ({ ...t }));
  }
}

/** Progressive trade size from equity. After the last explicit rung, size grows +$2 per additional $10. */
export function tradeSizeForEquity(
  equityUsd: number,
  tiers: EquitySizeTier[] = DEFAULT_SIZE_TIERS,
  stepUsd = DEFAULT_SIZE_STEP_USD,
  incrementUsd = DEFAULT_SIZE_INCREMENT_USD,
): { sizeUsd: number; tier: EquitySizeTier } {
  const sorted = [...tiers].sort((a, b) => a.minEquityUsd - b.minEquityUsd);
  const first = sorted[0] ?? DEFAULT_SIZE_TIERS[0];
  let chosen = first;
  for (const t of sorted) if (equityUsd >= t.minEquityUsd) chosen = t;
  const step = stepUsd > 0 ? stepUsd : DEFAULT_SIZE_STEP_USD;
  const inc = incrementUsd > 0 ? incrementUsd : DEFAULT_SIZE_INCREMENT_USD;
  const extra = Math.floor(Math.max(0, equityUsd - chosen.minEquityUsd) / step);
  const sizeUsd = chosen.sizeUsd + extra * inc;
  return { sizeUsd, tier: chosen };
}

export interface OwnerSizingInput {
  equityUsd: number;
  cashUsd: number;
  solPriceUsd: number;
  feeReserveSol: number;
  openExposureUsd?: number;
  minTradeUsd?: number;
}

export interface OwnerSizingResult {
  sizeUsd: number;
  tier: EquitySizeTier;
  reserveUsd: number;
  spendableUsd: number;
  notes: string[];
}

/** Dollar size for the next owner trade, never above equity (or cash) minus the SOL fee reserve. */
export function computeOwnerTradeSize(
  i: OwnerSizingInput,
  tiers: EquitySizeTier[] = DEFAULT_SIZE_TIERS,
  stepUsd = DEFAULT_SIZE_STEP_USD,
  incrementUsd = DEFAULT_SIZE_INCREMENT_USD,
): OwnerSizingResult {
  const notes: string[] = [];
  const equity = Math.max(0, Number(i.equityUsd) || 0);
  const cash = Math.max(0, Number(i.cashUsd) || 0);
  const solPrice = Math.max(0, Number(i.solPriceUsd) || 0);
  const reserveSol = Math.max(DEFAULT_FEE_RESERVE_SOL, Number(i.feeReserveSol) || DEFAULT_FEE_RESERVE_SOL);
  const reserveUsd = reserveSol * solPrice;
  const spendableUsd = Math.floor(Math.max(0, Math.min(equity, cash) - reserveUsd) * 100) / 100;
  const picked = tradeSizeForEquity(equity, tiers, stepUsd, incrementUsd);
  let size = Math.floor(picked.sizeUsd * 100) / 100;
  notes.push(`equity $${equity.toFixed(2)} → $${size.toFixed(2)} (tier from $${picked.tier.minEquityUsd})`);
  if (size > spendableUsd) {
    size = spendableUsd;
    notes.push(`capped at equity/cash minus ${reserveSol} SOL fee reserve ($${reserveUsd.toFixed(2)})`);
  }
  const minTrade = i.minTradeUsd ?? (tiers.map((x) => x.sizeUsd).sort((a, b) => a - b)[0] ?? DEFAULT_TRADE_SIZES.under10);
  if (size < minTrade) {
    notes.push(`below min trade $${minTrade} after reserve`);
    size = 0;
  }
  return { sizeUsd: Math.floor(size * 100) / 100, tier: picked.tier, reserveUsd, spendableUsd, notes };
}

export interface LadderParams {
  firstTargetUsd: number;
  stepUsd: number;
  amountUsd: number;
}

export interface LadderState {
  currentBaseUsd: number;
  nextTargetUsd: number;
}

export interface SweepRung {
  amountUsd: number;
  targetUsd: number;
  newBaseUsd: number;
  newTargetUsd: number;
  rungKey: string;
}

export const DEFAULT_LADDER_PARAMS: LadderParams = {
  firstTargetUsd: DEFAULT_SWEEP_FIRST_TARGET_USD,
  stepUsd: DEFAULT_SWEEP_STEP_USD,
  amountUsd: DEFAULT_SWEEP_AMOUNT_USD,
};

export function initialLadderState(p: LadderParams = DEFAULT_LADDER_PARAMS): LadderState {
  return { currentBaseUsd: 0, nextTargetUsd: p.firstTargetUsd };
}

/**
 * If equity has reached the next ladder target, return the rung to pay.
 * Sequence: hit $50 → send $25, base $25, next $75; hit $75 → send $25, base $50, next $100; …
 */
export function nextSweepRung(equityUsd: number, state: LadderState, p: LadderParams = DEFAULT_LADDER_PARAMS): SweepRung | null {
  const target = state.nextTargetUsd > 0 ? state.nextTargetUsd : p.firstTargetUsd;
  if (!(equityUsd >= target)) return null;
  const newBaseUsd = state.currentBaseUsd + p.amountUsd;
  const newTargetUsd = newBaseUsd + p.stepUsd;
  return { amountUsd: p.amountUsd, targetUsd: target, newBaseUsd, newTargetUsd, rungKey: sweepRungKey(target) };
}

export function sweepRungKey(targetUsd: number): string {
  return `sweep:t${targetUsd}`;
}

export function parseLadderSequence(maxTarget: number, p: LadderParams = DEFAULT_LADDER_PARAMS): Array<{ hit: number; baseAfter: number }> {
  const out: Array<{ hit: number; baseAfter: number }> = [];
  let state = initialLadderState(p);
  // Walk targets up to maxTarget as if equity exactly hits each target.
  while (state.nextTargetUsd <= maxTarget) {
    const rung = nextSweepRung(state.nextTargetUsd, state, p);
    if (!rung) break;
    out.push({ hit: rung.targetUsd, baseAfter: rung.newBaseUsd });
    state = { currentBaseUsd: rung.newBaseUsd, nextTargetUsd: rung.newTargetUsd };
  }
  return out;
}

export interface OwnerPlanConfig {
  enabled: boolean;
  payoutWallet: string | null;
  confirmedPayoutWallet: string | null;
  sweepArmed: boolean;
  feeReserveSol: number;
  sizeTiers: EquitySizeTier[];
  sizeStepUsd: number;
  sizeIncrementUsd: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxOpenPositions: number;
  /** Live owner daily loss stop, % of on-chain equity at the start of the day (OWNER_MAX_DAILY_LOSS_PCT). */
  maxDailyLossPct: number;
  /**
   * Taper exits for the live owner (all optional; null/[] = inherit the global setting):
   * OWNER_TP_LADDER "50:50" sells 50% at +50%; OWNER_BREAK_EVEN_TRIGGER_PCT moves the stop on the remainder
   * to break-even once the peak reaches it; OWNER_TRAILING_ARM_PCT / OWNER_TRAILING_STOP_PCT trail the remainder.
   */
  tpLadder: TpRung[];
  breakEvenTriggerPct: number | null;
  trailingArmPct: number | null;
  trailingStopPct: number | null;
  /** OWNER_ADAPTIVE_EXITS=on: each live trade gets its own exit plan (src/lib/adaptive-exits.ts); the fixed numbers above become the fallback. */
  adaptiveExits: boolean;
  minTradeUsd: number;
  ladder: LadderParams;
  dailyCapUsd: number;
  mcapPreset: 'BALANCED';
}

export function parseOwnerPlanConfig(env: Record<string, string | undefined> = {}): OwnerPlanConfig {
  const payoutWallet = str(env.PAYOUT_WALLET) || null;
  const confirmed = str(env.PAYOUT_WALLET_CONFIRMED) || null;
  const feeReserveSol = Math.max(DEFAULT_FEE_RESERVE_SOL, num(env.OWNER_FEE_RESERVE_SOL, DEFAULT_FEE_RESERVE_SOL));
  const ladder: LadderParams = {
    firstTargetUsd: num(env.OWNER_SWEEP_FIRST_TARGET_USD, DEFAULT_SWEEP_FIRST_TARGET_USD),
    stepUsd: num(env.OWNER_SWEEP_STEP_USD, DEFAULT_SWEEP_STEP_USD),
    amountUsd: num(env.OWNER_SWEEP_AMOUNT_USD, DEFAULT_SWEEP_AMOUNT_USD),
  };
  const sweepArmed = Boolean(payoutWallet && confirmed && payoutWallet === confirmed);
  return {
    enabled: bool(env.OWNER_PLAN_ENABLED, true),
    payoutWallet,
    confirmedPayoutWallet: confirmed,
    sweepArmed,
    feeReserveSol,
    sizeTiers: parseSizeTiers(env.OWNER_SIZE_TIERS),
    sizeStepUsd: num(env.OWNER_SIZE_STEP_USD, DEFAULT_SIZE_STEP_USD),
    sizeIncrementUsd: num(env.OWNER_SIZE_INCREMENT_USD, DEFAULT_SIZE_INCREMENT_USD),
    stopLossPct: num(env.OWNER_STOP_LOSS_PCT, DEFAULT_OWNER_STOP_LOSS_PCT),
    takeProfitPct: num(env.OWNER_TAKE_PROFIT_PCT, DEFAULT_OWNER_TAKE_PROFIT_PCT),
    maxOpenPositions: Math.max(1, Math.round(num(env.OWNER_MAX_OPEN_POSITIONS, DEFAULT_OWNER_MAX_OPEN_POSITIONS))),
    maxDailyLossPct: num(env.OWNER_MAX_DAILY_LOSS_PCT, 15),
    tpLadder: parseTpLadder(env.OWNER_TP_LADDER ?? ''),
    breakEvenTriggerPct: optNum(env.OWNER_BREAK_EVEN_TRIGGER_PCT),
    trailingArmPct: optNum(env.OWNER_TRAILING_ARM_PCT),
    trailingStopPct: optNum(env.OWNER_TRAILING_STOP_PCT),
    adaptiveExits: ['on', 'true', '1'].includes(String(env.OWNER_ADAPTIVE_EXITS ?? '').trim().toLowerCase()),
    minTradeUsd: num(env.OWNER_MIN_TRADE_USD, DEFAULT_TRADE_SIZES.under10),
    ladder,
    dailyCapUsd: num(env.OWNER_SWEEP_DAILY_CAP_USD, DEFAULT_SWEEP_DAILY_CAP_USD),
    mcapPreset: 'BALANCED',
  };
}

export type SweepBlockReason =
  | 'disabled'
  | 'no_payout_wallet'
  | 'not_confirmed'
  | 'address_changed'
  | 'open_position'
  | 'below_target'
  | 'daily_cap'
  | 'invalid_destination'
  | 'confirmation_mismatch'
  | 'already_paid';

export interface SweepGateInput {
  plan: OwnerPlanConfig;
  /** Live re-read of PAYOUT_WALLET (must match the planned destination). */
  livePayoutWallet: string | null;
  confirmedPayoutWallet: string | null;
  openPositions: number;
  equityUsd: number;
  ladder: LadderState;
  paidTodayUsd: number;
  alreadyPaidRungKeys: string[];
  tradingWallet: string;
}

export type SweepGate =
  | { ok: true; rung: SweepRung; destination: string }
  | { ok: false; reason: SweepBlockReason; message: string; rung?: SweepRung };

export function gateSweep(i: SweepGateInput): SweepGate {
  if (!i.plan.enabled) return { ok: false, reason: 'disabled', message: 'Owner money plan is disabled' };
  const configured = i.plan.payoutWallet;
  if (!configured) return { ok: false, reason: 'no_payout_wallet', message: 'PAYOUT_WALLET is not set; profit sweep is disabled' };
  if (!i.livePayoutWallet || i.livePayoutWallet !== configured) {
    return { ok: false, reason: 'confirmation_mismatch', message: 'PAYOUT_WALLET confirmation re-read did not match the planned destination' };
  }
  const confirmed = i.confirmedPayoutWallet ?? i.plan.confirmedPayoutWallet;
  if (!confirmed) return { ok: false, reason: 'not_confirmed', message: 'Payout wallet is not confirmed (set PAYOUT_WALLET_CONFIRMED to the same address)' };
  if (confirmed !== configured) {
    return { ok: false, reason: 'address_changed', message: 'Payout wallet changed; sweep is paused until it is re-confirmed' };
  }
  const dest = validateDestination(configured, i.tradingWallet);
  if (!dest.ok) return { ok: false, reason: 'invalid_destination', message: dest.error };
  if (dest.address !== configured) {
    return { ok: false, reason: 'confirmation_mismatch', message: 'Destination did not round-trip to PAYOUT_WALLET' };
  }
  if (i.openPositions > 0) return { ok: false, reason: 'open_position', message: 'Sweep only runs when flat (no open position)' };
  const rung = nextSweepRung(i.equityUsd, i.ladder, i.plan.ladder);
  if (!rung) return { ok: false, reason: 'below_target', message: `Equity $${i.equityUsd.toFixed(2)} is below the next sweep target $${i.ladder.nextTargetUsd}` };
  if (i.alreadyPaidRungKeys.includes(rung.rungKey)) {
    return { ok: false, reason: 'already_paid', message: `Rung ${rung.rungKey} was already paid`, rung };
  }
  if (i.paidTodayUsd + rung.amountUsd > i.plan.dailyCapUsd + 1e-9) {
    return { ok: false, reason: 'daily_cap', message: `Sweep would exceed the daily cap of $${i.plan.dailyCapUsd}`, rung };
  }
  return { ok: true, rung, destination: dest.address };
}

export function samePubkey(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.trim() === b.trim();
}

/** True when this swap is the owner's own trade (trading wallet or operator account), even if the fee wallet is the payout address. */
export function isOwnerTrade(taker: string | null | undefined, opts?: { isOwnerAccount?: boolean }, feeWallet?: string | null): boolean {
  if (opts?.isOwnerAccount) return true;
  if (taker && samePubkey(taker, OWNER_TRADING_WALLET)) return true;
  if (taker && feeWallet && samePubkey(taker, feeWallet)) return true;
  return false;
}

export interface OwnerPlanStatusView {
  enabled: boolean;
  sweepArmed: boolean;
  sweepPausedReason: string | null;
  payoutWallet: string | null;
  tradingWallet: string;
  equityUsd: number;
  currentTier: EquitySizeTier;
  tradeSizeUsd: number;
  feeReserveSol: number;
  feeReserveUsd: number;
  currentBaseUsd: number;
  nextSweepTargetUsd: number;
  totalPaidUsd: number;
  paidTodayUsd: number;
  openPositions: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxOpenPositions: number;
  mcapPreset: 'BALANCED';
  payouts: Array<{ rungKey: string; amountUsd: number; targetUsd: number; status: string; signature: string | null; toAddress: string; at: string }>;
}

export function describeOwnerPlan(s: OwnerPlanStatusView): string {
  const size = s.tradeSizeUsd > 0 ? `$${s.tradeSizeUsd.toFixed(2)}` : 'no size (need more equity after the fee reserve)';
  const sweep = s.sweepArmed
    ? (s.sweepPausedReason ?? `next sweep at $${s.nextSweepTargetUsd.toFixed(0)} (base $${s.currentBaseUsd.toFixed(0)}); $${s.totalPaidUsd.toFixed(2)} paid out so far`)
    : (s.sweepPausedReason ?? 'profit sweep is not armed');
  return `Owner plan: equity $${s.equityUsd.toFixed(2)}, ${s.maxOpenPositions} position at a time, ${s.stopLossPct}% stop / ${s.takeProfitPct}% take-profit, Balanced band. Current trade size ${size} (tier from $${s.currentTier.minEquityUsd}). ${sweep}.`;
}

export function reserveLamportsForTrading(feeReserveSol: number): number {
  return Math.round(Math.max(DEFAULT_FEE_RESERVE_SOL, feeReserveSol) * LAMPORTS_PER_SOL);
}

export const SWEEP_MEMO_PREFIX = 'cletus-sweep:';
export function sweepMemo(rungKey: string): string {
  return `${SWEEP_MEMO_PREFIX}${rungKey}`;
}
export function rungKeyFromMemo(memo: string): string | null {
  const s = memo.trim();
  if (!s.startsWith(SWEEP_MEMO_PREFIX)) return null;
  const key = s.slice(SWEEP_MEMO_PREFIX.length).trim();
  return key.startsWith('sweep:') ? key : `sweep:${key}`;
}

export function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Recovery mode on the owner plan drops the trade back to the smallest (base) tier size. */
export function ownerRecoverySize(tiers: { sizeUsd: number }[]): number | null {
  const sizes = tiers.map((t) => t.sizeUsd).filter((x) => Number.isFinite(x) && x > 0);
  return sizes.length ? Math.min(...sizes) : null;
}
