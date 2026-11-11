import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  orderUrl, parseOrder, orderTxProblem, describeOrderError, parseExecute, describeExecute, RETRYABLE_EXECUTE,
  expectedFeeBps, platformFeeBps, feePenalty, effectiveQuoteFeeBps, operatorFeeConfig, shouldChargeOperatorFee,
  referralParamsForOrder, DEFAULT_OPERATOR_FEE_WALLET, bucketRps, jupiterKey, reserve, newLimiter, backoffFromHeaders,
  JUP_SWAP_BASE, getOrder, executeOrder, jupFetch, JupiterRateLimited, SOL_MINT,
} from '../src/lib/jupiter';
import { fillFromQuote, simFeesUsd, simBuy } from '../src/lib/sim-quote';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const live = { inAmount: '100000000', outAmount: '1795757466', feeBps: 10, feeMint: SOL_MINT, priceImpactPct: '0.00094', router: 'metis', mode: 'ultra', requestId: 'req-1', transaction: null, inUsdValue: 15.1, outUsdValue: 15.08 };

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Jupiter Swap API V2 client', () => {
  it('targets api.jup.ag/swap/v2 by default and never V1 / lite-api / Ultra', () => {
    expect(JUP_SWAP_BASE()).toBe('https://api.jup.ag/swap/v2');
    const u = orderUrl({ inputMint: SOL_MINT, outputMint: BONK, amount: 100000000n, taker: 'Taker111', slippageBps: 150.4 });
    expect(u).toMatch(/^https:\/\/api\.jup\.ag\/swap\/v2\/order\?/);
    expect(u).toContain('taker=Taker111'); expect(u).toContain('slippageBps=150'); expect(u).toContain('amount=100000000');
    expect(u).not.toMatch(/quote|swap\/v1|lite-api|ultra/);
    const q = orderUrl({ inputMint: SOL_MINT, outputMint: BONK, amount: 5 });
    expect(q).not.toContain('taker'); expect(q).not.toContain('slippageBps');
  });

  it('parses a keyless quote (transaction null) and treats it as quote-only', () => {
    const o = parseOrder(live);
    expect(o.priceImpactPct).toBeCloseTo(0.00094); expect(o.feeBps).toBe(10); expect(o.transaction).toBeNull();
    expect(orderTxProblem(o, false)).toBeNull();
    expect(orderTxProblem(o, true)).toBe('no transaction returned');
  });

  it('surfaces transaction:"" + errorCode by router + code', () => {
    const o = parseOrder({ ...live, transaction: '', errorCode: 2, errorMessage: 'Insufficient SOL' });
    expect(orderTxProblem(o, true)).toBe('[metis] insufficient SOL for gas');
    expect(describeOrderError('jupiterz', 2)).toBe('missing associated token account');
    expect(describeOrderError('dflow', 9)).toBe('order error 9');
    expect(orderTxProblem(parseOrder({ ...live, outAmount: '0' }), false)).toBe('no route');
  });

  it('maps /execute codes and which ones are retryable', () => {
    expect(parseExecute({ status: 'Success', signature: 'sig', code: 0, totalOutputAmount: '42' })).toMatchObject({ status: 'Success', code: 0, signature: 'sig', totalOutputAmount: '42' });
    expect(parseExecute({ status: 'Failed', code: -1005, error: 'expired' })).toMatchObject({ status: 'Failed', code: -1005 });
    expect(describeExecute(-2004)).toBe('RFQ: swap rejected');
    expect(describeExecute(-9)).toBe('execute error -9');
    for (const c of [-1, -1000, -1005, -2003]) expect(RETRYABLE_EXECUTE.has(c)).toBe(true);
    for (const c of [-2, -3, -1002, -1003, -2004]) expect(RETRYABLE_EXECUTE.has(c)).toBe(false);
  });

  it('platform fee table: 50 bps for tokens < 24 h old, 10 bps otherwise; penalty nets the extra round trip', () => {
    const off = { OPERATOR_FEE_BPS: '0' };
    expect(platformFeeBps(3, off)).toBe(50); expect(platformFeeBps(23.9, off)).toBe(50);
    expect(platformFeeBps(24, off)).toBe(10); expect(platformFeeBps(null, off)).toBe(10);
    expect(expectedFeeBps(24, off, { chargeOperatorFee: false })).toBe(10);
    expect(feePenalty(10)).toBe(0); expect(feePenalty(50)).toBeCloseTo(0.04);
  });

  it('operator fee defaults to 50 bps on the payout wallet, clamped to Jupiter 50–255, disabled at 0', () => {
    expect(operatorFeeConfig({}).wallet).toBe(DEFAULT_OPERATOR_FEE_WALLET);
    expect(operatorFeeConfig({}).feeBps).toBe(50);
    expect(operatorFeeConfig({}).enabled).toBe(true);
    expect(operatorFeeConfig({ OPERATOR_FEE_BPS: '0' }).enabled).toBe(false);
    expect(operatorFeeConfig({ OPERATOR_FEE_BPS: '25' }).feeBps).toBe(50); // Jupiter minimum
    expect(operatorFeeConfig({ OPERATOR_FEE_BPS: '300' }).feeBps).toBe(255);
    expect(operatorFeeConfig({ OPERATOR_FEE_WALLET: ' Wallet111 ' }).wallet).toBe('Wallet111');
    expect(operatorFeeConfig({ JUPITER_REFERRAL_ACCOUNT: 'Ref111' }).referralAccount).toBe('Ref111');
  });

  it('charges users 50 bps even on older tokens; skips the operator wallet unless OPERATOR_FEE_ON_OWNER', () => {
    const env = { OPERATOR_FEE_BPS: '50', OPERATOR_FEE_WALLET: DEFAULT_OPERATOR_FEE_WALLET };
    expect(shouldChargeOperatorFee('SomeUser111', {}, env)).toBe(true);
    expect(shouldChargeOperatorFee(DEFAULT_OPERATOR_FEE_WALLET, {}, env)).toBe(false);
    expect(shouldChargeOperatorFee(null, { isOwnerAccount: true }, env)).toBe(false);
    expect(shouldChargeOperatorFee(DEFAULT_OPERATOR_FEE_WALLET, { isOwnerAccount: true }, { ...env, OPERATOR_FEE_ON_OWNER: 'true' })).toBe(true);
    expect(expectedFeeBps(24, env, { chargeOperatorFee: true })).toBe(50);
    expect(expectedFeeBps(3, env, { chargeOperatorFee: true })).toBe(50);
    expect(expectedFeeBps(24, env, { chargeOperatorFee: false })).toBe(10);
    expect(effectiveQuoteFeeBps(10, env, { chargeOperatorFee: true })).toBe(50);
    expect(effectiveQuoteFeeBps(10, env, { chargeOperatorFee: false })).toBe(10);
    expect(effectiveQuoteFeeBps(10, env, { chargeOperatorFee: true, referralAttached: true })).toBe(10);
    expect(referralParamsForOrder('SomeUser111', env)).toBeNull(); // no referral account yet
    expect(referralParamsForOrder('SomeUser111', { ...env, JUPITER_REFERRAL_ACCOUNT: 'Ref111' })).toEqual({ referralAccount: 'Ref111', referralFee: 50 });
    expect(referralParamsForOrder(DEFAULT_OPERATOR_FEE_WALLET, { ...env, JUPITER_REFERRAL_ACCOUNT: 'Ref111' })).toBeNull();
  });

  it('attaches referralAccount + referralFee to /order only when configured and the taker should be charged', () => {
    const env = { JUPITER_REFERRAL_ACCOUNT: 'Ref111', OPERATOR_FEE_BPS: '50', OPERATOR_FEE_WALLET: DEFAULT_OPERATOR_FEE_WALLET };
    const charged = orderUrl({ inputMint: SOL_MINT, outputMint: BONK, amount: 5, taker: 'User111' }, undefined, env);
    expect(charged).toContain('referralAccount=Ref111'); expect(charged).toContain('referralFee=50');
    const owner = orderUrl({ inputMint: SOL_MINT, outputMint: BONK, amount: 5, taker: DEFAULT_OPERATOR_FEE_WALLET }, undefined, env);
    expect(owner).not.toContain('referralAccount');
    const off = orderUrl({ inputMint: SOL_MINT, outputMint: BONK, amount: 5, taker: 'User111', applyOperatorFee: false }, undefined, env);
    expect(off).not.toContain('referralAccount');
  });

  it('rate limits: keyless 0.5 RPS, free key 1 RPS, separate /execute bucket; 429 backoff honours x-ratelimit-reset', () => {
    expect(bucketRps('main', {})).toBe(0.5); expect(bucketRps('main', { JUPITER_API_KEY: 'k' })).toBe(1);
    expect(bucketRps('execute', {})).toBe(20); expect(bucketRps('execute', { JUPITER_API_KEY: 'k' })).toBe(50);
    expect(jupiterKey({ JUPITER_API_KEY: '  ' })).toBeNull();
    const l = newLimiter();
    expect(reserve(l, 0.5, 1000)).toBe(0); expect(reserve(l, 0.5, 1000)).toBe(2000); expect(reserve(l, 0.5, 1000)).toBe(4000);
    const b = newLimiter(); backoffFromHeaders(b, { get: (n) => (n === 'x-ratelimit-reset' ? '1700000030' : null) }, 1_700_000_000_000);
    expect(b.blockedUntil).toBe(1_700_000_030_000);
  });

  it('sends x-api-key only when JUPITER_API_KEY is set, and GET /order + POST /execute shapes', async () => {
    vi.stubEnv('JUPITER_API_KEY', 'test-key'); vi.stubEnv('JUPITER_RPS', '1000'); vi.stubEnv('JUPITER_EXECUTE_RPS', '1000');
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.endsWith('/execute') ? { status: 'Failed', code: -1003, error: 'not fully signed' } : { ...live, transaction: 'AAAA' };
      return new Response(JSON.stringify(body), { status: url.endsWith('/execute') ? 400 : 200 });
    }));
    const o = await getOrder({ inputMint: SOL_MINT, outputMint: BONK, amount: 1n, taker: 'T', slippageBps: 100 });
    expect(o.requestId).toBe('req-1');
    const ex = await executeOrder('c2lnbmVk', o.requestId);
    expect(ex).toMatchObject({ status: 'Failed', code: -1003 });
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe('test-key');
    expect(calls[1].init.method).toBe('POST');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ signedTransaction: 'c2lnbmVk', requestId: 'req-1' });
  });

  it('keyless requests carry no x-api-key; 429 throws JupiterRateLimited', async () => {
    vi.stubEnv('JUPITER_API_KEY', ''); vi.stubEnv('JUPITER_RPS', '1000');
    let hdrs: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { hdrs = init.headers as Record<string, string>; return new Response('{}', { status: 429, headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1) } }); }));
    await expect(jupFetch('https://api.jup.ag/swap/v2/order?x=1')).rejects.toBeInstanceOf(JupiterRateLimited);
    expect(hdrs['x-api-key']).toBeUndefined();
    await expect(jupFetch('https://api.jup.ag/swap/v2/order?x=1', { maxWaitMs: 0 })).rejects.toBeInstanceOf(JupiterRateLimited);
  });
});

describe('simulation fills from keyless quotes', () => {
  it('applies impact to the mid and charges feeBps + network fee', () => {
    expect(fillFromQuote('buy', 1, 0.02)).toBeCloseTo(1.02); expect(fillFromQuote('sell', 1, 0.02)).toBeCloseTo(0.98);
    expect(simFeesUsd(100, 50, 5000, 200)).toBeCloseTo(0.5 + 0.001);
  });
  it('falls back to the pool model when quotes are off', async () => {
    vi.stubEnv('SIM_JUPITER_QUOTES', 'off');
    const f = await simBuy({ mint: BONK, sizeUsd: 50, mid: 1, solPriceUsd: 150, liquidityUsd: 100_000, fallbackImpact: 0.05, ageHours: 2 });
    expect(f.source).toBe('model'); expect(f.feeBps).toBe(50); expect(f.fillPrice).toBeGreaterThan(1);
  });
  it('uses the live quote (no taker) when available', async () => {
    vi.stubEnv('JUPITER_RPS', '1000');
    let url = '';
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { url = u; return new Response(JSON.stringify({ ...live, feeBps: 50, priceImpactPct: '0.01' }), { status: 200 }); }));
    const f = await simBuy({ mint: BONK, sizeUsd: 15, mid: 2, solPriceUsd: 150, fallbackImpact: 0.05, ageHours: 2 });
    expect(f).toMatchObject({ source: 'jupiter', feeBps: 50, router: 'metis' }); expect(f.fillPrice).toBeCloseTo(2.02);
    expect(url).not.toContain('taker'); expect(url).toContain('amount=100000000');
  });
  it('books the 0.5% operator fee on a 10 bps quote when no referral account is set, and skips it for the owner', async () => {
    vi.stubEnv('JUPITER_RPS', '1000'); vi.stubEnv('OPERATOR_FEE_BPS', '50'); vi.stubEnv('JUPITER_REFERRAL_ACCOUNT', '');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...live, feeBps: 10, priceImpactPct: '0' }), { status: 200 })));
    const user = await simBuy({ mint: BONK, sizeUsd: 15, mid: 2, solPriceUsd: 150, fallbackImpact: 0.05, ageHours: 48, chargeOperatorFee: true });
    expect(user).toMatchObject({ source: 'jupiter', feeBps: 50 });
    const owner = await simBuy({ mint: BONK, sizeUsd: 15, mid: 2, solPriceUsd: 150, fallbackImpact: 0.05, ageHours: 48, chargeOperatorFee: false });
    expect(owner).toMatchObject({ source: 'jupiter', feeBps: 10 });
  });
  it('model fallback for an older token still charges 50 bps when the operator fee applies', async () => {
    vi.stubEnv('SIM_JUPITER_QUOTES', 'off'); vi.stubEnv('OPERATOR_FEE_BPS', '50');
    const mint = 'ModelMint11111111111111111111111111111111111';
    const user = await simBuy({ mint, sizeUsd: 50, mid: 1, solPriceUsd: 150, liquidityUsd: 100_000, fallbackImpact: 0.05, ageHours: 48, chargeOperatorFee: true });
    expect(user.source).toBe('model'); expect(user.feeBps).toBe(50);
    const ownerMint = 'ModelMint22222222222222222222222222222222222';
    const owner = await simBuy({ mint: ownerMint, sizeUsd: 50, mid: 1, solPriceUsd: 150, liquidityUsd: 100_000, fallbackImpact: 0.05, ageHours: 48, chargeOperatorFee: false });
    expect(owner.feeBps).toBe(10);
  });
});
