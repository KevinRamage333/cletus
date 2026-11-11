import { describe, it, expect, vi, afterEach } from 'vitest';
import { priceFromSwapMeta, acceptFastPrice, fastPriceFromSignature, fastPriceOn, TrailingDebounce, WSOL_MINT } from '../src/lib/fast-price';
import { subscribeRequest, parseNotification, wsIsStale, wsMode } from '../src/lib/helius';

const BASE = 'Base1111111111111111111111111111111111111111';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const bal = (owner: string, mint: string, ui: number, decimals = 6) => ({ owner, mint, uiTokenAmount: { amount: String(Math.round(ui * 10 ** decimals)), decimals } });

describe('priceFromSwapMeta', () => {
  it('prices a buy from the pool vault deltas (WSOL quote)', () => {
    // Pool: 1,000,000 base / 10 SOL. Trader buys 9,000 base for 0.1 SOL.
    const meta = {
      err: null,
      preTokenBalances: [bal('POOL', BASE, 1_000_000), bal('POOL', WSOL_MINT, 10, 9), bal('TRADER', BASE, 0)],
      postTokenBalances: [bal('POOL', BASE, 991_000), bal('POOL', WSOL_MINT, 10.1, 9), bal('TRADER', BASE, 9_000)],
    };
    const r = priceFromSwapMeta(meta, BASE, 150)!;
    expect(r.owner).toBe('POOL');
    expect(r.priceUsd).toBeCloseTo((0.1 / 9000) * 150, 10);
  });
  it('prefers the owner holding the most base (pool) when the trader also has a quote leg', () => {
    const meta = {
      preTokenBalances: [bal('POOL', BASE, 500_000), bal('POOL', WSOL_MINT, 5, 9), bal('TRADER', BASE, 10_000), bal('TRADER', WSOL_MINT, 0, 9)],
      postTokenBalances: [bal('POOL', BASE, 510_000), bal('POOL', WSOL_MINT, 4.9, 9), bal('TRADER', BASE, 0), bal('TRADER', WSOL_MINT, 0.099, 9)],
    };
    const r = priceFromSwapMeta(meta, BASE, 100)!;
    expect(r.owner).toBe('POOL');
    expect(r.priceUsd).toBeCloseTo((0.1 / 10_000) * 100, 10);
  });
  it('USDC quote is priced at $1', () => {
    const meta = { preTokenBalances: [bal('P', BASE, 100), bal('P', USDC, 50)], postTokenBalances: [bal('P', BASE, 90), bal('P', USDC, 55)] };
    expect(priceFromSwapMeta(meta, BASE, 0)!.priceUsd).toBeCloseTo(0.5, 10);
  });
  it('returns null for a failed tx, no base leg, same-sign legs, or missing SOL price', () => {
    expect(priceFromSwapMeta({ err: { x: 1 }, preTokenBalances: [], postTokenBalances: [] }, BASE, 100)).toBeNull();
    expect(priceFromSwapMeta({ preTokenBalances: [bal('P', USDC, 1)], postTokenBalances: [bal('P', USDC, 2)] }, BASE, 100)).toBeNull();
    expect(priceFromSwapMeta({ preTokenBalances: [bal('P', BASE, 1), bal('P', USDC, 1)], postTokenBalances: [bal('P', BASE, 2), bal('P', USDC, 2)] }, BASE, 100)).toBeNull();
    expect(priceFromSwapMeta({ preTokenBalances: [bal('P', BASE, 2), bal('P', WSOL_MINT, 1, 9)], postTokenBalances: [bal('P', BASE, 1), bal('P', WSOL_MINT, 2, 9)] }, BASE, 0)).toBeNull();
    expect(priceFromSwapMeta(null, BASE, 100)).toBeNull();
  });
});

describe('acceptFastPrice', () => {
  it('accepts within the jump limit, rejects outliers and junk', () => {
    expect(acceptFastPrice(1.2, 1, 35)).toBe(true);
    expect(acceptFastPrice(0.7, 1, 35)).toBe(true);
    expect(acceptFastPrice(0.5, 1, 35)).toBe(false);
    expect(acceptFastPrice(2, 1, 35)).toBe(false);
    expect(acceptFastPrice(2, null, 35)).toBe(true);
    expect(acceptFastPrice(NaN, 1, 35)).toBe(false);
    expect(acceptFastPrice(0, 1, 35)).toBe(false);
  });
});

describe('fastPriceFromSignature', () => {
  const meta = { preTokenBalances: [bal('P', BASE, 100), bal('P', USDC, 50)], postTokenBalances: [bal('P', BASE, 90), bal('P', USDC, 55)] };
  it('retries once when the tx is not yet available, then prices it', async () => {
    const rpc = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ meta });
    const px = await fastPriceFromSignature('sig', BASE, 100, { rpc: rpc as never, sleep: async () => undefined });
    expect(px).toBeCloseTo(0.5);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][0]).toBe('getTransaction');
  });
  it('returns null (caller falls back) when the RPC keeps failing', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('timeout'));
    expect(await fastPriceFromSignature('sig', BASE, 100, { rpc: rpc as never, sleep: async () => undefined })).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe('TrailingDebounce', () => {
  afterEach(() => vi.useRealTimers());
  it('runs the first event now and the latest of a burst after the window', async () => {
    vi.useFakeTimers();
    const seen: Array<[string, string]> = [];
    const d = new TrailingDebounce<string>(1000, (k, v) => seen.push([k, v]));
    d.push('m', 'a'); d.push('m', 'b'); d.push('m', 'c'); d.push('x', 'z');
    expect(seen).toEqual([['m', 'a'], ['x', 'z']]);
    await vi.advanceTimersByTimeAsync(1001);
    expect(seen).toEqual([['m', 'a'], ['x', 'z'], ['m', 'c']]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen.length).toBe(3);
  });
});

describe('Helius WebSocket mode (flag)', () => {
  it('defaults to the legacy account subscription; FAST_PRICE_WS=on switches to logs', () => {
    expect(fastPriceOn({})).toBe(false);
    expect(wsMode({})).toBe('account');
    expect(wsMode({ FAST_PRICE_WS: 'on' })).toBe('logs');
    expect(subscribeRequest('POOL', 3, 'logs')).toEqual({ jsonrpc: '2.0', id: 3, method: 'logsSubscribe', params: [{ mentions: ['POOL'] }, { commitment: 'confirmed' }] });
    expect(subscribeRequest('POOL', 4, 'account').method).toBe('accountSubscribe');
  });
  it('parses notifications; ignores failed swaps', () => {
    expect(parseNotification({ method: 'accountNotification', params: { subscription: 7 } })).toEqual({ subscription: 7 });
    expect(parseNotification({ method: 'logsNotification', params: { subscription: 8, result: { value: { signature: 'S', err: null } } } })).toEqual({ subscription: 8, signature: 'S' });
    expect(parseNotification({ method: 'logsNotification', params: { subscription: 8, result: { value: { signature: 'S', err: { e: 1 } } } } })).toBeNull();
    expect(parseNotification({ id: 0, result: 'ok' })).toBeNull();
  });
  it('flags a silent connected socket as stale', () => {
    expect(wsIsStale(true, 1000, 100_000, 90_000)).toBe(true);
    expect(wsIsStale(true, 50_000, 100_000, 90_000)).toBe(false);
    expect(wsIsStale(false, 1000, 100_000, 90_000)).toBe(false);
  });
});
