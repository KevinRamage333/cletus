/**
 * Owner profit-sweep execution. Pure gating lives in owner-plan.ts; this module
 * persists ladder state, sends SOL (live) or records a simulated payout, and
 * is idempotent across crashes (unique rung key + memo / recent-signature lookup).
 *
 * Never sends unless PAYOUT_WALLET is set, confirmed, re-read, and the account is flat.
 * Destination is only the configured PAYOUT_WALLET. Live trading stays off until the owner says go.
 */
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { prisma } from './db';
import { log } from './logger';
import { getConfig } from './config';
import { isDemo } from './demo';
import { getOperatorWalletAddress as getOperatorPublicKey } from './wallet';
import {
  LAMPORTS_PER_SOL,
  computeSend,
  validateDestination,
} from './withdraw';
import {
  OWNER_TRADING_WALLET,
  DEFAULT_FEE_RESERVE_SOL,
  describeOwnerPlan,
  gateSweep,
  initialLadderState,
  parseOwnerPlanConfig,
  reserveLamportsForTrading,
  rungKeyFromMemo,
  sweepMemo,
  tradeSizeForEquity,
  utcDayKey,
  type LadderState,
  type OwnerPlanStatusView,
  type SweepRung,
} from './owner-plan';

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

async function engine() {
  return import('./engine');
}

export interface SweepDeps {
  mode: 'simulation' | 'live';
  liveEnabled: boolean;
  tradingWallet: string;
  readPayoutWallet: () => string | null;
  getOpenPositionCount: () => Promise<number>;
  getEquityUsd: () => Promise<number>;
  getBalanceLamports: () => Promise<number>;
  solPriceUsd: () => number;
  loadState: () => Promise<{
    ladder: LadderState;
    confirmedPayoutWallet: string | null;
    paidTodayUsd: number;
    alreadyPaidRungKeys: string[];
    totalPaidUsd: number;
  }>;
  /** Persist a pending row (unique on rungKey). Return 'created' or 'exists'. */
  beginRung: (r: { rungKey: string; targetUsd: number; newBaseUsd: number; amountUsd: number; amountLamports: number; toAddress: string; memo: string; mode: string }) => Promise<'created' | 'exists'>;
  lookupOnChain: (rungKey: string, toAddress: string) => Promise<string | null>;
  sendTransfer: (to: string, lamports: number, memo: string) => Promise<string>;
  finalizeRung: (r: { rungKey: string; status: 'sent' | 'simulated' | 'failed' | 'skipped'; signature?: string | null; error?: string | null; newBaseUsd: number; newTargetUsd: number; amountUsd: number }) => Promise<void>;
  log: (level: 'info' | 'warn' | 'error' | 'trade', msg: string) => Promise<void>;
  journal: (title: string, content: string) => Promise<void>;
}

export interface SweepResult {
  status: 'sent' | 'simulated' | 'skipped' | 'failed' | 'recovered';
  reason?: string;
  signature: string | null;
  rungKey?: string;
  amountUsd?: number;
  message: string;
}

const sol = (l: number) => `${(l / LAMPORTS_PER_SOL).toFixed(6)} SOL`;
const short = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

export async function executeProfitSweep(deps: SweepDeps, now = new Date()): Promise<SweepResult> {
  const plan = parseOwnerPlanConfig(process.env);
  const livePayout = deps.readPayoutWallet();
  const st = await deps.loadState();
  const open = await deps.getOpenPositionCount();
  const equityUsd = await deps.getEquityUsd();

  const gate = gateSweep({
    plan: { ...plan, payoutWallet: plan.payoutWallet ?? livePayout },
    livePayoutWallet: livePayout,
    confirmedPayoutWallet: st.confirmedPayoutWallet ?? plan.confirmedPayoutWallet,
    openPositions: open,
    equityUsd,
    ladder: st.ladder,
    paidTodayUsd: st.paidTodayUsd,
    alreadyPaidRungKeys: st.alreadyPaidRungKeys,
    tradingWallet: deps.tradingWallet,
  });
  if (!gate.ok) {
    return { status: 'skipped', reason: gate.reason, signature: null, rungKey: gate.rung?.rungKey, message: gate.message };
  }

  const destCheck = validateDestination(gate.destination, deps.tradingWallet);
  if (!destCheck.ok || destCheck.address !== livePayout) {
    return { status: 'skipped', reason: 'confirmation_mismatch', signature: null, message: 'Destination failed the confirmation re-read' };
  }
  // Hard rule: destination is ONLY the configured (re-read) PAYOUT_WALLET.
  if (destCheck.address !== (plan.payoutWallet ?? livePayout) || destCheck.address !== livePayout) {
    return { status: 'skipped', reason: 'confirmation_mismatch', signature: null, message: 'Destination is not the configured PAYOUT_WALLET' };
  }

  const solPrice = deps.solPriceUsd();
  const reserve = reserveLamportsForTrading(plan.feeReserveSol);
  const amountSol = gate.rung.amountUsd / Math.max(solPrice, 1e-9);
  const bal = await deps.getBalanceLamports();
  const amt = computeSend({ balanceLamports: bal, amountSol, reserveLamports: reserve });
  if (!amt.ok) {
    await deps.log('warn', `profit-sweep skipped ${gate.rung.rungKey}: ${amt.error}`);
    return { status: 'skipped', reason: 'insufficient', signature: null, rungKey: gate.rung.rungKey, message: amt.error };
  }

  const memo = sweepMemo(gate.rung.rungKey);
  const began = await deps.beginRung({
    rungKey: gate.rung.rungKey,
    targetUsd: gate.rung.targetUsd,
    newBaseUsd: gate.rung.newBaseUsd,
    amountUsd: gate.rung.amountUsd,
    amountLamports: amt.lamports,
    toAddress: destCheck.address,
    memo,
    mode: deps.mode,
  });

  if (began === 'exists') {
    const existing = await deps.lookupOnChain(gate.rung.rungKey, destCheck.address);
    if (existing) {
      await deps.finalizeRung({
        rungKey: gate.rung.rungKey, status: deps.mode === 'live' ? 'sent' : 'simulated',
        signature: existing, newBaseUsd: gate.rung.newBaseUsd, newTargetUsd: gate.rung.newTargetUsd, amountUsd: gate.rung.amountUsd,
      });
      await deps.log('trade', `profit-sweep recovered ${gate.rung.rungKey}: already on-chain ${existing}`);
      return { status: 'recovered', signature: existing, rungKey: gate.rung.rungKey, amountUsd: gate.rung.amountUsd, message: `Recovered existing payout ${gate.rung.rungKey} sig ${existing}` };
    }
    // Pending with no on-chain tx: only resend if we still need to (crash before send).
  }

  // Crash recovery before a first insert: look up on-chain so we never pay the same rung twice.
  const already = await deps.lookupOnChain(gate.rung.rungKey, destCheck.address);
  if (already) {
    await deps.finalizeRung({
      rungKey: gate.rung.rungKey, status: 'sent', signature: already,
      newBaseUsd: gate.rung.newBaseUsd, newTargetUsd: gate.rung.newTargetUsd, amountUsd: gate.rung.amountUsd,
    });
    await deps.log('trade', `profit-sweep recovered ${gate.rung.rungKey}: found ${already} before send`);
    return { status: 'recovered', signature: already, rungKey: gate.rung.rungKey, amountUsd: gate.rung.amountUsd, message: `Recovered existing payout ${gate.rung.rungKey} sig ${already}` };
  }

  if (deps.mode !== 'live' || !deps.liveEnabled) {
    await deps.finalizeRung({
      rungKey: gate.rung.rungKey, status: 'simulated', signature: null,
      newBaseUsd: gate.rung.newBaseUsd, newTargetUsd: gate.rung.newTargetUsd, amountUsd: gate.rung.amountUsd,
    });
    const msg = `SIMULATED profit sweep ${gate.rung.rungKey}: ${sol(amt.lamports)} ($${gate.rung.amountUsd.toFixed(2)}) to ${short(destCheck.address)}; base now $${gate.rung.newBaseUsd}, next target $${gate.rung.newTargetUsd} (no transaction sent)`;
    await deps.log('trade', msg);
    await deps.journal(`💸 Profit sweep (sim) $${gate.rung.amountUsd.toFixed(0)} at $${gate.rung.targetUsd}`, msg);
    void now;
    return { status: 'simulated', signature: null, rungKey: gate.rung.rungKey, amountUsd: gate.rung.amountUsd, message: msg };
  }

  try {
    await deps.log('warn', `profit-sweep LIVE sending ${sol(amt.lamports)} ($${gate.rung.amountUsd.toFixed(2)}) to ${short(destCheck.address)} ${gate.rung.rungKey}`);
    const sig = await deps.sendTransfer(destCheck.address, amt.lamports, memo);
    await deps.finalizeRung({
      rungKey: gate.rung.rungKey, status: 'sent', signature: sig,
      newBaseUsd: gate.rung.newBaseUsd, newTargetUsd: gate.rung.newTargetUsd, amountUsd: gate.rung.amountUsd,
    });
    const msg = `LIVE profit sweep ${gate.rung.rungKey}: sent ${sol(amt.lamports)} ($${gate.rung.amountUsd.toFixed(2)}) to ${short(destCheck.address)} sig ${sig}; base now $${gate.rung.newBaseUsd}, next $${gate.rung.newTargetUsd}`;
    await deps.log('trade', msg);
    await deps.journal(`💸 Profit sweep $${gate.rung.amountUsd.toFixed(0)} at $${gate.rung.targetUsd}`, msg);
    return { status: 'sent', signature: sig, rungKey: gate.rung.rungKey, amountUsd: gate.rung.amountUsd, message: msg };
  } catch (e) {
    const err = (e as Error).message.slice(0, 300);
    // After a send error, check whether it actually landed (crash / timeout).
    const landed = await deps.lookupOnChain(gate.rung.rungKey, destCheck.address).catch(() => null);
    if (landed) {
      await deps.finalizeRung({
        rungKey: gate.rung.rungKey, status: 'sent', signature: landed,
        newBaseUsd: gate.rung.newBaseUsd, newTargetUsd: gate.rung.newTargetUsd, amountUsd: gate.rung.amountUsd,
      });
      await deps.log('trade', `profit-sweep recovered after send error ${gate.rung.rungKey} sig ${landed}`);
      return { status: 'recovered', signature: landed, rungKey: gate.rung.rungKey, amountUsd: gate.rung.amountUsd, message: `Recovered payout ${gate.rung.rungKey} sig ${landed}` };
    }
    await deps.finalizeRung({
      rungKey: gate.rung.rungKey, status: 'failed', error: err,
      newBaseUsd: st.ladder.currentBaseUsd, newTargetUsd: st.ladder.nextTargetUsd, amountUsd: gate.rung.amountUsd,
    });
    await deps.log('error', `profit-sweep LIVE send failed ${gate.rung.rungKey}: ${err}`);
    return { status: 'failed', signature: null, rungKey: gate.rung.rungKey, amountUsd: gate.rung.amountUsd, message: `Send failed: ${err}` };
  }
}

async function paidTodayUsd(day = utcDayKey()): Promise<number> {
  const start = new Date(`${day}T00:00:00.000Z`);
  const rows = await prisma.profitSweepPayout.findMany({
    where: { createdAt: { gte: start }, status: { in: ['sent', 'simulated', 'pending'] } },
    select: { amountUsd: true },
  });
  return rows.reduce((s, r) => s + r.amountUsd, 0);
}

async function ensureSweepState() {
  const plan = parseOwnerPlanConfig(process.env);
  const init = initialLadderState(plan.ladder);
  return prisma.profitSweepState.upsert({
    where: { id: 'owner' },
    create: {
      id: 'owner',
      currentBaseUsd: init.currentBaseUsd,
      nextTargetUsd: init.nextTargetUsd,
      confirmedPayoutWallet: plan.sweepArmed ? plan.payoutWallet : null,
      paused: !plan.sweepArmed,
      pauseReason: plan.sweepArmed ? null : (!plan.payoutWallet ? 'PAYOUT_WALLET is not set' : 'payout wallet is not confirmed'),
    },
    update: {},
  });
}

/** Apply confirmation from env (PAYOUT_WALLET_CONFIRMED must equal PAYOUT_WALLET). */
export async function syncPayoutConfirmation(): Promise<{ confirmed: boolean; reason: string | null }> {
  const plan = parseOwnerPlanConfig(process.env);
  const st = await ensureSweepState();
  if (!plan.payoutWallet) {
    await prisma.profitSweepState.update({ where: { id: 'owner' }, data: { paused: true, pauseReason: 'PAYOUT_WALLET is not set' } });
    return { confirmed: false, reason: 'PAYOUT_WALLET is not set' };
  }
  if (!plan.confirmedPayoutWallet || plan.confirmedPayoutWallet !== plan.payoutWallet) {
    const changed = st.confirmedPayoutWallet && st.confirmedPayoutWallet !== plan.payoutWallet;
    const reason = changed
      ? 'Payout wallet changed; sweep is paused until PAYOUT_WALLET_CONFIRMED matches the new address'
      : 'Set PAYOUT_WALLET_CONFIRMED to the same address as PAYOUT_WALLET to arm the profit sweep';
    await prisma.profitSweepState.update({
      where: { id: 'owner' },
      data: { pendingPayoutWallet: plan.payoutWallet, paused: true, pauseReason: reason },
    });
    return { confirmed: false, reason };
  }
  await prisma.profitSweepState.update({
    where: { id: 'owner' },
    data: { confirmedPayoutWallet: plan.payoutWallet, pendingPayoutWallet: null, paused: false, pauseReason: null },
  });
  return { confirmed: true, reason: null };
}

export function memoInstruction(memo: string): TransactionInstruction {
  return new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM_ID, data: Buffer.from(memo, 'utf8') });
}

/**
 * All account keys of a fetched transaction (legacy or v0). A v0 swap that uses address lookup tables makes
 * message.getAccountKeys() throw ("address table lookups were not resolved") unless the loaded addresses are passed,
 * which used to abort the whole sweep lookup on the first Jupiter swap in the wallet's history. Never throws.
 */
export function txAccountKeys(tx: { transaction: { message: { getAccountKeys: (a?: { accountKeysFromLookups?: { writable: PublicKey[]; readonly: PublicKey[] } | null }) => { keySegments: () => PublicKey[][] } } }; meta?: { loadedAddresses?: { writable: PublicKey[]; readonly: PublicKey[] } | null } | null }): string[] {
  try {
    const lookups = tx.meta?.loadedAddresses ?? undefined;
    return tx.transaction.message.getAccountKeys(lookups ? { accountKeysFromLookups: lookups } : undefined).keySegments().flat().map((k) => k.toBase58());
  } catch { return []; }
}

export async function lookupSweepSignature(rungKey: string, toAddress: string, tradingWallet: string): Promise<string | null> {
  const { connection } = await import('./executor');
  const conn = connection(getConfig());
  const want = sweepMemo(rungKey);
  const sigs = await conn.getSignaturesForAddress(new PublicKey(tradingWallet), { limit: 25 });
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    if (!tx) continue;
    const keys = txAccountKeys(tx);
    if (!keys.length) continue;
    const toIdx = keys.indexOf(toAddress);
    if (toIdx < 0) continue;
    // Memo in log messages, or as a program instruction.
    const logs = tx.meta?.logMessages ?? [];
    const memoLog = logs.find((l) => l.includes(want) || l.includes(rungKey));
    if (memoLog) return s.signature;
    if (tx.meta?.innerInstructions) { /* fall through to memo field */ }
    const memo = typeof s.memo === 'string' ? s.memo : null;
    if (memo && (memo.includes(want) || rungKeyFromMemo(memo) === rungKey)) return s.signature;
  }
  return null;
}

export async function serverSweepDeps(): Promise<SweepDeps | null> {
  if (isDemo()) return null;
  const op = getOperatorPublicKey();
  if (!op) return null;
  const c = getConfig();
  const { ensureOperatorAccount, accountEquity, mem } = await engine();
  const account = await ensureOperatorAccount();
  return {
    mode: c.mode,
    liveEnabled: c.mode === 'live' && process.env.WITHDRAW_LIVE_ENABLED === 'true',
    tradingWallet: op,
    readPayoutWallet: () => parseOwnerPlanConfig(process.env).payoutWallet,
    getOpenPositionCount: async () => prisma.position.count({ where: { accountId: account.id, status: 'open' } }),
    getEquityUsd: async () => {
      if (c.mode === 'live') {
        const { connection } = await import('./executor');
        const lamports = await connection(c).getBalance(new PublicKey(op));
        const solPrice = mem.solPrice || c.solPriceFallbackUsd;
        const { openValue } = await accountEquity(account);
        return (lamports / LAMPORTS_PER_SOL) * solPrice + openValue;
      }
      const { equity } = await accountEquity(account);
      return equity;
    },
    getBalanceLamports: async () => {
      const { connection } = await import('./executor');
      return connection(c).getBalance(new PublicKey(op));
    },
    solPriceUsd: () => mem.solPrice || c.solPriceFallbackUsd,
    loadState: async () => {
      const conf = await syncPayoutConfirmation();
      void conf;
      const st = await ensureSweepState();
      const plan = parseOwnerPlanConfig(process.env);
      const paid = await prisma.profitSweepPayout.findMany({
        where: { status: { in: ['sent', 'simulated', 'pending'] } },
        select: { rungKey: true },
      });
      return {
        ladder: { currentBaseUsd: st.currentBaseUsd, nextTargetUsd: st.nextTargetUsd },
        confirmedPayoutWallet: st.confirmedPayoutWallet ?? plan.confirmedPayoutWallet,
        paidTodayUsd: await paidTodayUsd(),
        alreadyPaidRungKeys: paid.map((p) => p.rungKey),
        totalPaidUsd: st.totalPaidUsd,
      };
    },
    beginRung: async (r) => {
      try {
        await prisma.profitSweepPayout.create({
          data: {
            rungKey: r.rungKey, targetUsd: r.targetUsd, baseAfterUsd: r.newBaseUsd, amountUsd: r.amountUsd,
            amountLamports: String(r.amountLamports), toAddress: r.toAddress, memo: r.memo, mode: r.mode, status: 'pending',
          },
        });
        return 'created';
      } catch {
        return 'exists';
      }
    },
    lookupOnChain: async (rungKey, to) => {
      const row = await prisma.profitSweepPayout.findUnique({ where: { rungKey } });
      if (row?.signature && (row.status === 'sent' || row.status === 'simulated')) return row.signature;
      if (c.mode !== 'live') return row?.signature ?? null;
      try { return await lookupSweepSignature(rungKey, to, op); } catch { return row?.signature ?? null; }
    },
    sendTransfer: async (to, lamports, memo) => (await import('./live-drawdown')).withBotTx(async () => {
      const { connection } = await import('./executor');
      const { loadOperatorKeypair } = await import('./wallet');
      const kp = loadOperatorKeypair();
      const conn = connection(c);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const dest = validateDestination(to, op);
      if (!dest.ok) throw new Error(dest.error);
      const planned = parseOwnerPlanConfig(process.env).payoutWallet;
      if (!planned || dest.address !== planned) throw new Error('Destination is not the configured PAYOUT_WALLET');
      const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight })
        .add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(dest.address), lamports }))
        .add(memoInstruction(memo));
      tx.sign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      if (conf.value.err) throw new Error(`transaction failed: ${JSON.stringify(conf.value.err)}`);
      return sig;
    }),
    finalizeRung: async (r) => {
      const advance = r.status === 'sent' || r.status === 'simulated';
      await prisma.$transaction([
        prisma.profitSweepPayout.upsert({
          where: { rungKey: r.rungKey },
          create: {
            rungKey: r.rungKey, targetUsd: 0, baseAfterUsd: r.newBaseUsd, amountUsd: r.amountUsd,
            amountLamports: '0', toAddress: parseOwnerPlanConfig(process.env).payoutWallet ?? '', memo: sweepMemo(r.rungKey),
            mode: c.mode, status: r.status, signature: r.signature ?? null, error: r.error ?? null,
          },
          update: { status: r.status, signature: r.signature ?? undefined, error: r.error ?? null },
        }),
        ...(advance
          ? [prisma.profitSweepState.update({
              where: { id: 'owner' },
              data: { currentBaseUsd: r.newBaseUsd, nextTargetUsd: r.newTargetUsd, totalPaidUsd: { increment: r.amountUsd } },
            })]
          : []),
      ]);
    },
    log: (level, msg) => log(level, msg, account.id),
    journal: async (title, content) => {
      await prisma.journalEntry.create({
        data: { kind: 'payout', accountId: account.id, title, content, source: 'heuristic' },
      });
    },
  };
}

/** Called by the engine when the operator account is flat. Never throws. */
export async function maybeRunProfitSweep(): Promise<SweepResult | null> {
  try {
    const deps = await serverSweepDeps();
    if (!deps) return null;
    const result = await executeProfitSweep(deps);
    // A sweep is money paid out to the owner, not a trading loss: move the live drawdown peak with it.
    if (result?.status === 'sent' && result.amountUsd) {
      try { (await import('./live-drawdown')).recordFlow(-result.amountUsd, 'sweep'); } catch { /* never block a sweep */ }
    }
    if (result && (result.status === 'sent' || result.status === 'recovered')) {
      try {
        const { appendLiveTrade } = await import('./live-trade-log');
        appendLiveTrade({
          type: 'sweep', side: 'sweep', token: 'SOL', symbol: 'SOL', mint: null,
          sizeUsd: result.amountUsd ?? null, signature: result.signature, reason: result.rungKey ?? result.message,
          simulated: false,
        });
      } catch { /* trade log must never block a sweep */ }
    }
    return result;
  } catch (e) {
    await log('warn', `profit-sweep tick failed: ${(e as Error).message}`);
    return { status: 'failed', signature: null, message: (e as Error).message };
  }
}

export async function ownerPlanStatus(opts?: { equityUsd?: number; openPositions?: number; cashUsd?: number; solPriceUsd?: number }): Promise<OwnerPlanStatusView> {
  const c = getConfig();
  const plan = c.ownerPlan;
  let state: { currentBaseUsd: number; nextTargetUsd: number; totalPaidUsd: number; confirmedPayoutWallet: string | null; paused: boolean; pauseReason: string | null } | null = null;
  let payouts: OwnerPlanStatusView['payouts'] = [];
  let paidToday = 0;
  try {
    const st = await prisma.profitSweepState.findUnique({ where: { id: 'owner' } });
    if (st) {
      state = st;
      payouts = (await prisma.profitSweepPayout.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })).map((p) => ({
        rungKey: p.rungKey, amountUsd: p.amountUsd, targetUsd: p.targetUsd, status: p.status, signature: p.signature, toAddress: p.toAddress, at: p.createdAt.toISOString(),
      }));
      paidToday = await paidTodayUsd();
    }
  } catch { /* schema may not be migrated yet */ }
  const equityUsd = opts?.equityUsd ?? 0;
  const { mem } = await engine();
  const solPrice = opts?.solPriceUsd ?? (mem.solPrice || c.solPriceFallbackUsd);
  const sized = tradeSizeForEquity(equityUsd, plan.sizeTiers, plan.sizeStepUsd, plan.sizeIncrementUsd);
  const reserveUsd = plan.feeReserveSol * solPrice;
  let sweepPausedReason: string | null = null;
  if (!plan.payoutWallet) sweepPausedReason = 'PAYOUT_WALLET is not set; profit sweep is disabled';
  else if (!plan.sweepArmed) sweepPausedReason = 'Payout wallet is not confirmed (set PAYOUT_WALLET_CONFIRMED to the same address)';
  else if (state?.paused) sweepPausedReason = state.pauseReason;
  else if ((opts?.openPositions ?? 0) > 0) sweepPausedReason = 'Waiting to be flat (an open position is active)';
  const spendable = Math.max(0, Math.min(equityUsd, opts?.cashUsd ?? equityUsd) - reserveUsd);
  const tradeSizeUsd = Math.floor(Math.min(sized.sizeUsd, spendable) * 100) / 100;
  const view: OwnerPlanStatusView = {
    enabled: plan.enabled,
    sweepArmed: plan.sweepArmed && !state?.paused,
    sweepPausedReason,
    payoutWallet: plan.payoutWallet,
    tradingWallet: OWNER_TRADING_WALLET,
    equityUsd,
    currentTier: sized.tier,
    tradeSizeUsd: tradeSizeUsd >= plan.minTradeUsd ? tradeSizeUsd : 0,
    feeReserveSol: plan.feeReserveSol,
    feeReserveUsd: reserveUsd,
    currentBaseUsd: state?.currentBaseUsd ?? 0,
    nextSweepTargetUsd: state?.nextTargetUsd ?? plan.ladder.firstTargetUsd,
    totalPaidUsd: state?.totalPaidUsd ?? 0,
    paidTodayUsd: paidToday,
    openPositions: opts?.openPositions ?? 0,
    stopLossPct: plan.stopLossPct,
    takeProfitPct: plan.takeProfitPct,
    maxOpenPositions: plan.maxOpenPositions,
    mcapPreset: 'BALANCED',
    payouts,
  };
  return view;
}

export function ownerPlanSummary(s: OwnerPlanStatusView): string {
  return describeOwnerPlan(s);
}

/** Re-export for tests that simulate a crash between send and record. */
export type { SweepRung };

/** Lamports reserved for gas so an exit sell can always land. */
export const ownerFeeReserveSol = () => Math.max(DEFAULT_FEE_RESERVE_SOL, Number(process.env.OWNER_FEE_RESERVE_SOL ?? DEFAULT_FEE_RESERVE_SOL) || DEFAULT_FEE_RESERVE_SOL);
