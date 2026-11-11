/**
 * Helius integration (server-side only; URLs/keys never leave the server or the logs).
 *  - On-chain holder concentration from getTokenLargestAccounts + owner lookup (PDAs = pools/lockers excluded)
 *    and DAS getTokenAccounts for the holder count.
 *  - WebSocket accountSubscribe on each open position's pool account: any swap touching the pool
 *    triggers an immediate exit check for that token (polling stays as the backstop).
 */
import { PublicKey } from '@solana/web3.js';
import { fastPriceOn, fastPriceParams } from './fast-price';

export function heliusConfig(env: Record<string, string | undefined> = process.env) {
  const ok = (v?: string) => (v && !v.includes('your_') ? v : null);
  const rpc = ok(env.HELIUS_RPC_URL) ?? (ok(env.HELIUS_API_KEY) ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}` : null);
  const ws = ok(env.HELIUS_WS_URL) ?? (ok(env.HELIUS_API_KEY) ? `wss://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}` : null);
  return { rpc, ws, enabled: Boolean(rpc), wsEnabled: Boolean(ws) && env.HELIUS_WS_DISABLED !== 'true' };
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const { rpcCall } = await import('./rpc-pool');
  // DAS methods exist only on Helius; standard methods go through the Helius -> FluxRPC failover pool.
  return rpcCall<T>(method, params, { timeoutMs: 10_000, only: method === 'getTokenAccounts' || method === 'getAsset' ? 'helius' : undefined });
}

export interface HolderAccount { owner: string; amount: number; ownerIsPda: boolean }
export interface OnchainHolders { top1Pct: number; top10Pct: number; holders: number | null; excludedPdas: number }

/** Concentration over non-PDA owners, aggregated per owner (pure; unit-tested). */
export function concentrationFrom(accounts: HolderAccount[], supply: number, holders: number | null): OnchainHolders {
  const byOwner = new Map<string, number>();
  let excluded = 0;
  for (const a of accounts) {
    if (a.ownerIsPda) { excluded++; continue; }
    byOwner.set(a.owner, (byOwner.get(a.owner) ?? 0) + a.amount);
  }
  const sorted = [...byOwner.values()].sort((x, y) => y - x);
  const pct = (n: number) => (supply > 0 ? (n / supply) * 100 : 0);
  return { top1Pct: pct(sorted[0] ?? 0), top10Pct: pct(sorted.slice(0, 10).reduce((s, v) => s + v, 0)), holders, excludedPdas: excluded };
}

export function isPda(addr: string): boolean {
  try { return !PublicKey.isOnCurve(new PublicKey(addr).toBytes()); } catch { return false; }
}

export async function onchainHolders(mint: string): Promise<OnchainHolders | null> {
  if (!heliusConfig().enabled) return null;
  try {
    const [largest, supply] = await Promise.all([
      rpc<{ value: Array<{ address: string; uiAmount: number | null }> }>('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]),
      rpc<{ value: { uiAmount: number | null } }>('getTokenSupply', [mint]),
    ]);
    const addrs = largest.value.map((v) => v.address);
    const infos = addrs.length ? await rpc<{ value: Array<{ data?: { parsed?: { info?: { owner?: string } } } } | null> }>('getMultipleAccounts', [addrs, { encoding: 'jsonParsed' }]) : { value: [] };
    const accounts: HolderAccount[] = largest.value.map((v, i) => {
      const owner = infos.value[i]?.data?.parsed?.info?.owner ?? v.address;
      return { owner, amount: v.uiAmount ?? 0, ownerIsPda: isPda(owner) };
    });
    let holders: number | null = null;
    // DAS getTokenAccounts: one page of up to 1000 token accounts. `total` is the page size, so 1000 means "1000 or more".
    try { holders = (await rpc<{ total?: number; token_accounts?: unknown[] }>('getTokenAccounts', { mint, limit: 1000, page: 1 })).total ?? null; } catch { /* DAS optional */ }
    return concentrationFrom(accounts, supply.value.uiAmount ?? 0, holders);
  } catch { return null; }
}

// ─── WebSocket: pool account subscriptions for fast exits ─────────────────────

/** `signature` is set in logs mode (FAST_PRICE_WS=on): the swap that touched the pool. */
type OnChange = (mint: string, signature?: string) => void;
interface WsState { ws: WebSocket | null; subs: Map<string, { mint: string; subId: number | null; reqId: number }>; byReq: Map<number, string>; bySub: Map<number, string>; nextId: number; onChange: OnChange | null; retry: number; connecting: boolean; ping?: NodeJS.Timeout; connected: boolean; events: number; lastMsgAt?: number; staleReconnects?: number }
const g = globalThis as unknown as { __heliusWs?: WsState };
const st: WsState = (g.__heliusWs ??= { ws: null, subs: new Map(), byReq: new Map(), bySub: new Map(), nextId: 1, onChange: null, retry: 0, connecting: false, connected: false, events: 0 });

export function wsStatus() { return { connected: st.connected, subscriptions: st.subs.size, events: st.events, mode: wsMode(), lastMessageAgoSec: st.lastMsgAt ? Math.round((Date.now() - st.lastMsgAt) / 1000) : null, staleReconnects: st.staleReconnects ?? 0 }; }

/** 'logs' (FAST_PRICE_WS=on): logsSubscribe mentions=[pool], fires on every swap for every DEX type. 'account': legacy pool-account subscription. */
export const wsMode = (env: Record<string, string | undefined> = process.env): 'logs' | 'account' => (fastPriceOn(env) ? 'logs' : 'account');

/** JSON-RPC subscribe request for a pool in the given mode (pure; unit-tested). */
export function subscribeRequest(pool: string, id: number, mode: 'logs' | 'account') {
  return mode === 'logs'
    ? { jsonrpc: '2.0', id, method: 'logsSubscribe', params: [{ mentions: [pool] }, { commitment: 'confirmed' }] }
    : { jsonrpc: '2.0', id, method: 'accountSubscribe', params: [pool, { encoding: 'base64', commitment: 'processed' }] };
}

/** A notification for one of our subscriptions: { subscription, signature? } or null (failed tx / other message). Pure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseNotification(m: any): { subscription: number; signature?: string } | null {
  if (m?.method === 'accountNotification' && typeof m.params?.subscription === 'number') return { subscription: m.params.subscription };
  if (m?.method === 'logsNotification' && typeof m.params?.subscription === 'number') {
    const v = m.params.result?.value;
    if (!v || v.err || typeof v.signature !== 'string') return null; // failed swaps don't move the price
    return { subscription: m.params.subscription, signature: v.signature };
  }
  return null;
}

/** WebSocket watchdog (logs mode): connected but silent (no notifications, no ping replies) for longer than staleMs. Pure. */
export function wsIsStale(connected: boolean, lastMsgAt: number | undefined, now: number, staleMs: number): boolean {
  return connected && !!lastMsgAt && now - lastMsgAt > staleMs;
}

function send(obj: unknown) { if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify(obj)); }

function subscribe(pool: string) {
  const s = st.subs.get(pool);
  if (!s) return;
  const id = st.nextId++;
  s.reqId = id; s.subId = null;
  st.byReq.set(id, pool);
  send(subscribeRequest(pool, id, wsMode()));
}

function connect() {
  const { ws: url, wsEnabled } = heliusConfig();
  if (!wsEnabled || !url || st.connecting || (st.ws && st.ws.readyState <= 1)) return;
  const WS = (globalThis as unknown as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!WS) return;
  st.connecting = true;
  const ws = new WS(url);
  st.ws = ws;
  ws.onopen = () => {
    st.connecting = false; st.connected = true; st.retry = 0; st.bySub.clear(); st.byReq.clear(); st.lastMsgAt = Date.now();
    for (const pool of st.subs.keys()) subscribe(pool);
    clearInterval(st.ping);
    st.ping = setInterval(() => {
      // Logs mode watchdog: a socket that stopped answering (even pings) is closed so `down()` reconnects; polling covers the gap.
      if (wsMode() === 'logs' && wsIsStale(st.connected, st.lastMsgAt, Date.now(), fastPriceParams().wsStaleMs)) {
        st.staleReconnects = (st.staleReconnects ?? 0) + 1;
        console.log(`[cletus] Helius WebSocket silent >${Math.round(fastPriceParams().wsStaleMs / 1000)}s; reconnecting (polling continues)`);
        try { ws.close(); } catch { /* ignore */ }
        return;
      }
      send({ jsonrpc: '2.0', id: 0, method: 'getHealth' });
    }, 30_000);
    st.ping.unref?.();
  };
  ws.onmessage = (ev) => {
    let m: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    st.lastMsgAt = Date.now();
    if (m.id && typeof m.result === 'number' && st.byReq.has(m.id)) {
      const pool = st.byReq.get(m.id)!; st.byReq.delete(m.id);
      const s = st.subs.get(pool); if (s) { s.subId = m.result; st.bySub.set(m.result, pool); }
      return;
    }
    const n = parseNotification(m);
    if (n) {
      const pool = st.bySub.get(n.subscription);
      const s = pool ? st.subs.get(pool) : null;
      if (s) { st.events++; st.onChange?.(s.mint, n.signature); }
    }
  };
  const down = () => {
    st.connecting = false; st.connected = false; clearInterval(st.ping);
    if (st.ws === ws) st.ws = null;
    const delay = Math.min(60_000, 1000 * 2 ** st.retry++);
    if (st.subs.size) setTimeout(connect, delay);
  };
  ws.onclose = down;
  ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
}

/** Keep subscriptions in sync with the set of open positions ({pool -> mint}). */
export function syncPoolSubscriptions(pools: Map<string, string>, onChange: OnChange) {
  if (!heliusConfig().wsEnabled) return;
  st.onChange = onChange;
  for (const [pool, s] of st.subs) {
    if (!pools.has(pool)) {
      if (s.subId !== null) { send({ jsonrpc: '2.0', id: st.nextId++, method: wsMode() === 'logs' ? 'logsUnsubscribe' : 'accountUnsubscribe', params: [s.subId] }); st.bySub.delete(s.subId); }
      st.subs.delete(pool);
    }
  }
  for (const [pool, mint] of pools) {
    if (!st.subs.has(pool)) { st.subs.set(pool, { mint, subId: null, reqId: 0 }); if (st.connected) subscribe(pool); }
  }
  if (st.subs.size) connect();
  else if (st.ws) { try { st.ws.close(); } catch { /* ignore */ } }
}
