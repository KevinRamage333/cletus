import { describe, it, expect, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  computeOwnerTradeSize, gateSweep, initialLadderState, isOwnerTrade, nextSweepRung,
  parseLadderSequence, parseSizeTiers, parseOwnerPlanConfig, resolveOperatorFeeWallet,
  sweepMemo, rungKeyFromMemo, tradeSizeForEquity, OWNER_TRADING_WALLET, DEFAULT_SIZE_TIERS,
  DEFAULT_LADDER_PARAMS,
} from '@/lib/owner-plan';
import { executeProfitSweep, type SweepDeps } from '@/lib/profit-sweep';
import { operatorFeeConfig, shouldChargeOperatorFee, referralParamsForOrder } from '@/lib/jupiter';
import { LAMPORTS_PER_SOL } from '@/lib/withdraw';

const PAYOUT = Keypair.generate().publicKey.toBase58();
const OTHER = Keypair.generate().publicKey.toBase58();

describe('owner equity size tiers', () => {
  it('boundaries: under $10 → $3, $10–$20 → $5, $20–$30 → $7, then +$2 per $10', () => {
    const sz = (e: number) => tradeSizeForEquity(e).sizeUsd;
    expect(sz(0)).toBe(3);
    expect(sz(9.99)).toBe(3);
    expect(sz(10)).toBe(5);
    expect(sz(19.99)).toBe(5);
    expect(sz(20)).toBe(7);
    expect(sz(29.99)).toBe(7);
    expect(sz(30)).toBe(9);
    expect(sz(39.99)).toBe(9);
    expect(sz(40)).toBe(11);
    expect(sz(50)).toBe(13);
  });

  it('reads a configurable JSON tier table and still extends +$2 / $10 past the last rung', () => {
    const tiers = parseSizeTiers(JSON.stringify([
      { minEquityUsd: 0, sizeUsd: 3 },
      { minEquityUsd: 10, sizeUsd: 5 },
      { minEquityUsd: 20, sizeUsd: 7 },
    ]));
    expect(tradeSizeForEquity(25, tiers).sizeUsd).toBe(7);
    expect(tradeSizeForEquity(30, tiers).sizeUsd).toBe(9);
    expect(parseSizeTiers('not-json')).toEqual(DEFAULT_SIZE_TIERS);
  });

  it('never sizes above equity minus the 0.01 SOL fee reserve, and keeps a reserve for the exit sell', () => {
    const solPrice = 200; // reserve = $2
    const r = computeOwnerTradeSize({ equityUsd: 5, cashUsd: 5, solPriceUsd: solPrice, feeReserveSol: 0.01 });
    expect(r.reserveUsd).toBeCloseTo(2, 6);
    expect(r.sizeUsd).toBe(3); // $5 - $2 = $3 spendable, size $3
    const tight = computeOwnerTradeSize({ equityUsd: 3, cashUsd: 3, solPriceUsd: solPrice, feeReserveSol: 0.01 });
    expect(tight.sizeUsd).toBe(0); // $3 - $2 = $1, below min trade
    const mid = computeOwnerTradeSize({ equityUsd: 12, cashUsd: 12, solPriceUsd: solPrice, feeReserveSol: 0.01 });
    expect(mid.sizeUsd).toBe(5);
    const cashCapped = computeOwnerTradeSize({ equityUsd: 40, cashUsd: 4, solPriceUsd: 100, feeReserveSol: 0.01 });
    // cash $4 - reserve $1 = $3, even though equity tier is $11
    expect(cashCapped.sizeUsd).toBe(3);
  });
});

describe('profit sweep ladder', () => {
  it('sequence: 50 → base 25, 75 → 50, 100 → 75, 125 → 100', () => {
    expect(parseLadderSequence(125)).toEqual([
      { hit: 50, baseAfter: 25 },
      { hit: 75, baseAfter: 50 },
      { hit: 100, baseAfter: 75 },
      { hit: 125, baseAfter: 100 },
    ]);
    let s = initialLadderState();
    const r1 = nextSweepRung(50, s)!;
    expect(r1).toMatchObject({ amountUsd: 25, targetUsd: 50, newBaseUsd: 25, newTargetUsd: 75, rungKey: 'sweep:t50' });
    s = { currentBaseUsd: r1.newBaseUsd, nextTargetUsd: r1.newTargetUsd };
    expect(nextSweepRung(74.99, s)).toBeNull();
    const r2 = nextSweepRung(75, s)!;
    expect(r2).toMatchObject({ targetUsd: 75, newBaseUsd: 50, newTargetUsd: 100 });
  });

  it('never sweeps with an open position, even when equity is past the target', () => {
    const plan = parseOwnerPlanConfig({
      PAYOUT_WALLET: PAYOUT, PAYOUT_WALLET_CONFIRMED: PAYOUT,
    });
    const base = {
      plan, livePayoutWallet: PAYOUT, confirmedPayoutWallet: PAYOUT,
      equityUsd: 50, ladder: initialLadderState(), paidTodayUsd: 0, alreadyPaidRungKeys: [] as string[],
      tradingWallet: OWNER_TRADING_WALLET,
    };
    const blocked = gateSweep({ ...base, openPositions: 1 });
    expect(blocked).toMatchObject({ ok: false, reason: 'open_position' });
    const ok = gateSweep({ ...base, openPositions: 0 });
    expect(ok).toMatchObject({ ok: true, destination: PAYOUT, rung: { rungKey: 'sweep:t50', amountUsd: 25 } });
  });

  it('blocks when the payout address is missing, unconfirmed, changed, or fails a re-read', () => {
    const armed = parseOwnerPlanConfig({ PAYOUT_WALLET: PAYOUT, PAYOUT_WALLET_CONFIRMED: PAYOUT });
    const flat = {
      livePayoutWallet: PAYOUT, confirmedPayoutWallet: PAYOUT, openPositions: 0, equityUsd: 50,
      ladder: initialLadderState(), paidTodayUsd: 0, alreadyPaidRungKeys: [] as string[], tradingWallet: OWNER_TRADING_WALLET,
    };
    expect(gateSweep({ ...flat, plan: parseOwnerPlanConfig({}) })).toMatchObject({ ok: false, reason: 'no_payout_wallet' });
    expect(gateSweep({ ...flat, plan: parseOwnerPlanConfig({ PAYOUT_WALLET: PAYOUT }), confirmedPayoutWallet: null }))
      .toMatchObject({ ok: false, reason: 'not_confirmed' });
    expect(gateSweep({ ...flat, plan: armed, confirmedPayoutWallet: OTHER })).toMatchObject({ ok: false, reason: 'address_changed' });
    expect(gateSweep({ ...flat, plan: armed, livePayoutWallet: OTHER })).toMatchObject({ ok: false, reason: 'confirmation_mismatch' });
    expect(gateSweep({ ...flat, plan: armed, livePayoutWallet: null })).toMatchObject({ ok: false, reason: 'confirmation_mismatch' });
  });

  it('idempotency key and memo round-trip', () => {
    expect(rungKeyFromMemo(sweepMemo('sweep:t50'))).toBe('sweep:t50');
    expect(rungKeyFromMemo('cletus-sweep:sweep:t75')).toBe('sweep:t75');
  });
});

function mkDeps(over: Partial<SweepDeps> = {}) {
  const payout = PAYOUT;
  const calls = { send: [] as Array<[string, number, string]>, logs: [] as string[], journals: [] as string[], finalized: [] as string[] };
  let pending = new Set<string>();
  const paid = new Set<string>();
  let chain = new Map<string, string>(); // rungKey -> sig
  let ladder = initialLadderState();
  const deps: SweepDeps = {
    mode: 'simulation',
    liveEnabled: false,
    tradingWallet: OWNER_TRADING_WALLET,
    readPayoutWallet: () => payout,
    getOpenPositionCount: async () => 0,
    getEquityUsd: async () => 50,
    getBalanceLamports: async () => 1 * LAMPORTS_PER_SOL, // plenty
    solPriceUsd: () => 100, // $25 = 0.25 SOL
    loadState: async () => ({
      ladder, confirmedPayoutWallet: payout, paidTodayUsd: 0, alreadyPaidRungKeys: [...paid, ...pending], totalPaidUsd: 0,
    }),
    beginRung: async (r) => {
      if (pending.has(r.rungKey) || paid.has(r.rungKey)) return 'exists';
      pending.add(r.rungKey);
      return 'created';
    },
    lookupOnChain: async (rungKey) => chain.get(rungKey) ?? null,
    sendTransfer: async (to, lamports, memo) => {
      calls.send.push([to, lamports, memo]);
      const sig = `SIG-${calls.send.length}`;
      // extract rung from memo
      const key = memo.replace('cletus-sweep:', '');
      chain.set(key, sig);
      return sig;
    },
    finalizeRung: async (r) => {
      calls.finalized.push(`${r.rungKey}:${r.status}:${r.signature ?? ''}`);
      if (r.status === 'sent' || r.status === 'simulated') {
        paid.add(r.rungKey);
        pending.delete(r.rungKey);
        ladder = { currentBaseUsd: r.newBaseUsd, nextTargetUsd: r.newTargetUsd };
      }
    },
    log: async (_l, m) => { calls.logs.push(m); },
    journal: async (title, content) => { calls.journals.push(`${title}\n${content}`); },
    ...over,
  };
  return { deps, calls, paid, pending, chain, getLadder: () => ladder, setLadder: (s: typeof ladder) => { ladder = s; }, payout };
}

describe('profit sweep execution', () => {
  const envBak = { ...process.env };
  const arm = () => {
    process.env.PAYOUT_WALLET = PAYOUT;
    process.env.PAYOUT_WALLET_CONFIRMED = PAYOUT;
  };
  afterEach(() => {
    for (const k of ['PAYOUT_WALLET', 'PAYOUT_WALLET_CONFIRMED', 'OPERATOR_FEE_WALLET']) delete process.env[k];
    Object.assign(process.env, envBak);
  });

  it('simulation records a payout and does not send, then refuses the same rung', async () => {
    arm();
    const { deps, calls } = mkDeps();
    const r = await executeProfitSweep(deps);
    expect(r.status).toBe('simulated');
    expect(r.rungKey).toBe('sweep:t50');
    expect(calls.send).toHaveLength(0);
    expect(calls.journals.join(' ')).toMatch(/Profit sweep/);
    const again = await executeProfitSweep(deps);
    // Ladder advanced to next $75, and equity is still $50, so this tick is below the new target.
    expect(again.status).toBe('skipped');
    expect(again.reason).toBe('below_target');
  });

  it('never sends when a position is open', async () => {
    arm();
    const { deps, calls } = mkDeps({ getOpenPositionCount: async () => 1, liveEnabled: true, mode: 'live' });
    const r = await executeProfitSweep(deps);
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('open_position');
    expect(calls.send).toHaveLength(0);
  });

  it('live send goes only to PAYOUT_WALLET and logs the signature', async () => {
    arm();
    const { deps, calls, payout } = mkDeps({ mode: 'live', liveEnabled: true });
    const r = await executeProfitSweep(deps);
    expect(r.status).toBe('sent');
    expect(calls.send).toHaveLength(1);
    expect(calls.send[0][0]).toBe(payout);
    expect(calls.send[0][2]).toBe('cletus-sweep:sweep:t50');
    expect(r.signature).toMatch(/^SIG-/);
    expect(calls.logs.join(' ')).toMatch(/sig SIG-/);
  });

  it('after a crash between send and record, a memo/signature lookup recovers and does not resend', async () => {
    arm();
    const { deps, calls, chain, pending, paid } = mkDeps({ mode: 'live', liveEnabled: true });
    // First attempt: send lands, then finalize is skipped (crash).
    const origSend = deps.sendTransfer;
    deps.sendTransfer = async (to, lamports, memo) => {
      const sig = await origSend(to, lamports, memo);
      // simulate crash: leave rung pending, do not finalize
      throw new Error('crashed after send');
    };
    // Override execute path: we need the send to actually record on chain then throw after return?
    // The executeProfitSweep catches send errors and looks up on-chain. Our sendTransfer throws
    // BEFORE returning — so we must put the sig on-chain inside the throwing send.
    deps.sendTransfer = async (to, lamports, memo) => {
      calls.send.push([to, lamports, memo]);
      const sig = 'SIG-CRASH';
      chain.set(memo.replace('cletus-sweep:', ''), sig);
      throw new Error('crashed after send');
    };
    const first = await executeProfitSweep(deps);
    expect(first.status).toBe('recovered');
    expect(first.signature).toBe('SIG-CRASH');
    expect(calls.send).toHaveLength(1);
    expect(paid.has('sweep:t50') || first.status === 'recovered').toBe(true);

    // A later tick must not send again.
    const { deps: deps2, calls: calls2 } = mkDeps({
      mode: 'live', liveEnabled: true,
      loadState: async () => ({
        ladder: initialLadderState(), confirmedPayoutWallet: PAYOUT, paidTodayUsd: 0,
        alreadyPaidRungKeys: ['sweep:t50'], totalPaidUsd: 25,
      }),
    });
    const second = await executeProfitSweep(deps2);
    expect(second.status).toBe('skipped');
    expect(second.reason).toBe('already_paid');
    expect(calls2.send).toHaveLength(0);
    void pending;
  });

  it('refuses to send to any address other than PAYOUT_WALLET', async () => {
    arm();
    const { deps, calls } = mkDeps({
      mode: 'live', liveEnabled: true,
      readPayoutWallet: () => OTHER,
    });
    const r = await executeProfitSweep(deps);
    expect(r.status).toBe('skipped');
    expect(calls.send).toHaveLength(0);
  });
});


describe('operator fee wallet + owner skip', () => {
  it('OPERATOR_FEE_WALLET defaults to PAYOUT_WALLET when the fee wallet is unset', () => {
    expect(resolveOperatorFeeWallet({})).toBe(OWNER_TRADING_WALLET);
    expect(resolveOperatorFeeWallet({ PAYOUT_WALLET: PAYOUT })).toBe(PAYOUT);
    expect(resolveOperatorFeeWallet({ PAYOUT_WALLET: PAYOUT, OPERATOR_FEE_WALLET: OTHER })).toBe(OTHER);
    expect(operatorFeeConfig({ PAYOUT_WALLET: PAYOUT }).wallet).toBe(PAYOUT);
    expect(operatorFeeConfig({ PAYOUT_WALLET: PAYOUT, OPERATOR_FEE_WALLET: '  ' }).wallet).toBe(PAYOUT);
    expect(operatorFeeConfig({ OPERATOR_FEE_WALLET: OTHER, PAYOUT_WALLET: PAYOUT }).wallet).toBe(OTHER);
  });

  it('skips the platform fee on trades from the trading wallet even when the fee wallet is the payout address', () => {
    const env = { OPERATOR_FEE_BPS: '50', OPERATOR_FEE_WALLET: PAYOUT, PAYOUT_WALLET: PAYOUT };
    expect(shouldChargeOperatorFee('SomeUser111', {}, env)).toBe(true);
    expect(shouldChargeOperatorFee(OWNER_TRADING_WALLET, {}, env)).toBe(false);
    expect(shouldChargeOperatorFee(PAYOUT, {}, env)).toBe(false);
    expect(shouldChargeOperatorFee(null, { isOwnerAccount: true }, env)).toBe(false);
    expect(shouldChargeOperatorFee(OWNER_TRADING_WALLET, { isOwnerAccount: true }, env)).toBe(false);
    expect(shouldChargeOperatorFee(OWNER_TRADING_WALLET, {}, { ...env, OPERATOR_FEE_ON_OWNER: 'true' })).toBe(true);
    expect(isOwnerTrade(OWNER_TRADING_WALLET, {}, PAYOUT)).toBe(true);
    expect(referralParamsForOrder(OWNER_TRADING_WALLET, { ...env, JUPITER_REFERRAL_ACCOUNT: 'Ref111' })).toBeNull();
    expect(referralParamsForOrder('User111', { ...env, JUPITER_REFERRAL_ACCOUNT: 'Ref111' })).toEqual({ referralAccount: 'Ref111', referralFee: 50 });
  });
});
