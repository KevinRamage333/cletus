import { describe, it, expect, vi } from 'vitest';
import bs58 from 'bs58';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { capTip, privateRouteConfig, bundleIneligible, buildTipTx, base58, submitSwap, dryRunBundle, JITO_TIP_ACCOUNTS, HARD_MAX_TIP_LAMPORTS } from '../src/lib/private-route';
import type { JupExecute, JupOrder } from '../src/lib/jupiter';

const kp = Keypair.generate();
const BH = '11111111111111111111111111111111';
function swapTx() {
  const msg = new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: BH, instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message();
  const tx = new VersionedTransaction(msg); tx.sign([kp]); return tx;
}
const order = (o: Partial<JupOrder> = {}) => ({ requestId: 'req1', router: 'iris', gasless: false, transaction: 'AAA', inAmount: '1', outAmount: '2', ...o } as unknown as JupOrder);
const ok: JupExecute = { status: 'Success', signature: 'SIG', code: 0, totalInputAmount: '1', totalOutputAmount: '2', inputAmountResult: null, outputAmountResult: null, error: null };
const fail: JupExecute = { ...ok, status: 'Failed', signature: null, code: -1005, error: 'expired' };
const resp = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));

describe('private route config', () => {
  it('defaults off; jito needs the broadcast switch, otherwise it is a dry run', () => {
    expect(privateRouteConfig({}).mode).toBe('off');
    expect(privateRouteConfig({ PRIVATE_ROUTE: 'dryrun' }).mode).toBe('dryrun');
    const j = privateRouteConfig({ PRIVATE_ROUTE: 'jito' });
    expect(j.mode).toBe('dryrun'); expect(j.note).toMatch(/BROADCAST/);
    expect(privateRouteConfig({ PRIVATE_ROUTE: 'jito', PRIVATE_ROUTE_BROADCAST: 'true' }).mode).toBe('jito');
    expect(privateRouteConfig({ PRIVATE_ROUTE: 'bogus' }).mode).toBe('off');
  });
  it('caps the tip: default 10k, max 20k, hard ceiling, Jito minimum', () => {
    expect(privateRouteConfig({}).tipLamports).toBe(10_000);
    expect(privateRouteConfig({ JITO_TIP_LAMPORTS: '5000000' }).tipLamports).toBe(20_000);
    expect(capTip(5_000_000, 10_000_000)).toBe(HARD_MAX_TIP_LAMPORTS);
    expect(capTip(10, 20_000)).toBe(1_000);
  });
  it('RFQ and gasless orders are not bundle-eligible', () => {
    expect(bundleIneligible({ router: 'jupiterz', gasless: false, transaction: 'x' })).toMatch(/RFQ/);
    expect(bundleIneligible({ router: 'iris', gasless: true, transaction: 'x' })).toMatch(/gasless/);
    expect(bundleIneligible({ router: 'iris', gasless: false, transaction: 'x' })).toBeNull();
  });
});

describe('tip tx and base58', () => {
  it('builds a signed transfer to the tip account on the swap blockhash', () => {
    const tip = buildTipTx(kp, BH, JITO_TIP_ACCOUNTS[0], 10_000);
    expect(tip.message.recentBlockhash).toBe(BH);
    const keys = tip.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys).toContain(JITO_TIP_ACCOUNTS[0]);
    expect(keys[0]).toBe(kp.publicKey.toBase58());
    expect(tip.signatures[0].some((b) => b !== 0)).toBe(true);
    for (const a of JITO_TIP_ACCOUNTS) expect(() => new PublicKey(a)).not.toThrow();
  });
  it('base58 matches bs58', () => {
    const tx = swapTx();
    expect(base58(tx.signatures[0])).toBe(bs58.encode(tx.signatures[0]));
    expect(base58(new Uint8Array([0, 0, 1]))).toBe(bs58.encode(new Uint8Array([0, 0, 1])));
  });
});

describe('submitSwap', () => {
  it('off: plain Jupiter /execute, no network beyond it', async () => {
    const execute = vi.fn().mockResolvedValue(ok); const f = vi.fn();
    const r = await submitSwap({ order: order(), signedTx: swapTx(), kp, execute }, { env: {}, fetch: f as never });
    expect(r.route).toBe('jupiter'); expect(execute).toHaveBeenCalledTimes(1); expect(f).not.toHaveBeenCalled();
  });
  it('dryrun: executes via Jupiter, simulates only, never calls sendBundle', async () => {
    const execute = vi.fn().mockResolvedValue(ok);
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ landed_tips_50th_percentile: 0.00001 }])));
    const rpc = vi.fn().mockResolvedValue({ value: { err: null, unitsConsumed: 1234 } });
    const logs: string[] = [];
    const r = await submitSwap({ order: order(), signedTx: swapTx(), kp, execute }, { env: { PRIVATE_ROUTE: 'jito' }, fetch: f as never, rpc: rpc as never, log: (m) => logs.push(m) });
    expect(r.route).toBe('jupiter');
    await vi.waitFor(() => expect(logs.length).toBe(1));
    expect(logs[0]).toMatch(/nothing sent/); expect(logs[0]).toMatch(/median landed tip 10000/);
    expect(rpc.mock.calls.every((c) => c[0] === 'simulateTransaction')).toBe(true);
    expect(f.mock.calls.some((c) => String(c[0]).includes('/bundles') && !String(c[0]).includes('tip_floor'))).toBe(false);
  });
  it('dryRunBundle reports a failing simulation without throwing', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ value: { err: { InstructionError: [0, 'x'] } } }).mockRejectedValueOnce(new Error('timeout'));
    const r = await dryRunBundle(order(), swapTx(), kp, { env: {}, rpc: rpc as never, fetch: vi.fn().mockRejectedValue(new Error('x')) as never });
    expect(r.swapSim).toMatch(/^err/); expect(r.tipSim).toMatch(/rpc error/); expect(r.tipFloorP50Lamports).toBeNull();
  });
  const live = { PRIVATE_ROUTE: 'jito', PRIVATE_ROUTE_BROADCAST: 'true', PRIVATE_ROUTE_LAND_TIMEOUT_MS: '2000' };
  it('jito: bundle lands, then /execute confirms the same tx', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp('bundle-1')).mockResolvedValueOnce(resp({ value: [{ status: 'Landed' }] }));
    const execute = vi.fn().mockResolvedValue(ok);
    const tx = swapTx();
    const r = await submitSwap({ order: order(), signedTx: tx, kp, execute }, { env: live, fetch: f as never, sleep: async () => undefined });
    expect(r.route).toBe('jito');
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.method).toBe('sendBundle'); expect(body.params[0]).toHaveLength(2);
    expect(body.params[0][0]).toBe(execute.mock.calls[0][0]); // same signed swap tx
  });
  it('jito: block engine down -> falls back to Jupiter /execute', async () => {
    const f = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const execute = vi.fn().mockResolvedValue(ok);
    const r = await submitSwap({ order: order(), signedTx: swapTx(), kp, execute }, { env: live, fetch: f as never, sleep: async () => undefined, log: () => undefined });
    expect(r.route).toBe('jupiter_fallback'); expect(r.status).toBe('Success');
  });
  it('jito: RFQ order skips the bundle entirely', async () => {
    const f = vi.fn(); const execute = vi.fn().mockResolvedValue(ok);
    await submitSwap({ order: order({ router: 'jupiterz' } as never) as never, signedTx: swapTx(), kp, execute }, { env: live, fetch: f as never });
    expect(f).not.toHaveBeenCalled();
  });
  it('jito: landed but /execute fails -> chain check; unconfirmed is non-retryable (no double trade)', async () => {
    const mk = () => vi.fn().mockResolvedValueOnce(resp('b')).mockResolvedValueOnce(resp({ value: [{ status: 'Landed' }] }));
    const execute = vi.fn().mockResolvedValue(fail);
    const tx = swapTx();
    const confirmed = await submitSwap({ order: order(), signedTx: tx, kp, execute }, { env: live, fetch: mk() as never, sleep: async () => undefined, rpc: vi.fn().mockResolvedValue({ value: [{ err: null }] }) as never });
    expect(confirmed.status).toBe('Success'); expect(confirmed.signature).toBe(bs58.encode(tx.signatures[0]));
    const unknown = await submitSwap({ order: order(), signedTx: tx, kp, execute }, { env: live, fetch: mk() as never, sleep: async () => undefined, rpc: vi.fn().mockResolvedValue({ value: [null] }) as never });
    expect(unknown.status).toBe('Failed'); expect(unknown.code).toBe(-9001);
  });
});
