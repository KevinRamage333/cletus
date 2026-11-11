/**
 * Holder-sell exit (flag HOLDER_SELL_EXIT=on, default off; live owner positions only).
 * While we hold, every HOLDER_WATCH_SEC (120 s) take one on-chain snapshot of the creator wallet and the top-10
 * non-pool holders (getTokenLargestAccounts + owner lookup, PDAs excluded, + getTokenSupply). The first snapshot
 * after entry (or after a restart, persisted in logs/holder-baselines.json) is the baseline. If the creator or a
 * baseline top-10 holder has since sold >= 20% of its holding (and at least 0.1% of supply, so dust can't trigger),
 * or >= 1% of supply, the position exits right away ('dev_exit' / 'holder_exit').
 * Bounded: 3-4 RPC calls per position per 2 min, 10 s timeouts, never throws into the monitor; a failed snapshot
 * just skips that round. Our own wallet is never counted.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface HolderSnap { at: number; supply: number; holders: Record<string, number>; creator: string | null; creatorAmt: number | null }
export interface HolderSellRules { holdingFrac: number; minSupplyFrac: number; supplyFrac: number }
export const DEFAULT_HOLDER_RULES: HolderSellRules = { holdingFrac: 0.2, minSupplyFrac: 0.001, supplyFrac: 0.01 };
export interface HolderSellHit { reason: 'dev_exit' | 'holder_exit'; wallet: string; soldFrac: number; soldSupplyPct: number }

export const holderSellOn = () => ['on', 'true', '1'].includes((process.env.HOLDER_SELL_EXIT ?? '').toLowerCase());

/** Pure decision (unit-tested). `current` must include every baseline wallet (missing = unknown, skipped). */
export function holderSellDecision(base: HolderSnap, current: HolderSnap, rules: HolderSellRules = DEFAULT_HOLDER_RULES): HolderSellHit | null {
  const supply = base.supply > 0 ? base.supply : current.supply;
  if (!(supply > 0)) return null;
  const check = (wallet: string, before: number | null | undefined, after: number | null | undefined, reason: HolderSellHit['reason']): HolderSellHit | null => {
    if (!(typeof before === 'number' && before > 0) || typeof after !== 'number' || !(after >= 0)) return null;
    const sold = before - after;
    if (!(sold > 0)) return null;
    const soldFrac = sold / before, soldSupply = sold / supply;
    if ((soldFrac >= rules.holdingFrac && soldSupply >= rules.minSupplyFrac) || soldSupply >= rules.supplyFrac) {
      return { reason, wallet, soldFrac: Math.round(soldFrac * 1000) / 1000, soldSupplyPct: Math.round(soldSupply * 10000) / 100 };
    }
    return null;
  };
  if (base.creator) { const h = check(base.creator, base.creatorAmt, current.creatorAmt, 'dev_exit'); if (h) return h; }
  for (const [w, amt] of Object.entries(base.holders)) {
    if (w === base.creator) continue;
    const h = check(w, amt, current.holders[w], 'holder_exit'); if (h) return h;
  }
  return null;
}

type Rpc = <T>(method: string, params: unknown) => Promise<T>;
const defaultRpc: Rpc = async <T,>(method: string, params: unknown) => (await import('./rpc-pool')).rpcCall<T>(method, params, { timeoutMs: 10_000 });

async function balanceOf(rpc: Rpc, owner: string, mint: string): Promise<number | null> {
  try {
    const r = await rpc<{ value: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }> }>('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    return r.value.reduce((s, a) => s + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
  } catch { return null; }
}

/** One snapshot. `watch` = wallets that must be present (baseline holders): missing ones are read directly. */
export async function takeSnapshot(mint: string, creator: string | null, ownWallet: string | null, watch: string[] = [], rpc: Rpc = defaultRpc): Promise<HolderSnap | null> {
  try {
    const { isPda } = await import('./helius');
    const [largest, supply] = await Promise.all([
      rpc<{ value: Array<{ address: string; uiAmount: number | null }> }>('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]),
      rpc<{ value: { uiAmount: number | null } }>('getTokenSupply', [mint]),
    ]);
    const addrs = largest.value.map((v) => v.address);
    const infos = addrs.length ? await rpc<{ value: Array<{ data?: { parsed?: { info?: { owner?: string } } } } | null> }>('getMultipleAccounts', [addrs, { encoding: 'jsonParsed' }]) : { value: [] };
    const all: Record<string, number> = {};
    largest.value.forEach((v, i) => {
      const owner = infos.value[i]?.data?.parsed?.info?.owner ?? v.address;
      if (isPda(owner) || owner === ownWallet) return;
      all[owner] = (all[owner] ?? 0) + (v.uiAmount ?? 0);
    });
    const top = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const holders: Record<string, number> = Object.fromEntries(top);
    for (const w of watch.slice(0, 10)) {
      if (w in holders) continue;
      if (w in all) { holders[w] = all[w]; continue; }
      const b = await balanceOf(rpc, w, mint); // dropped out of the top 20: read it directly
      if (b !== null) holders[w] = b;
    }
    const creatorAmt = creator && creator !== ownWallet ? (creator in all ? all[creator] : await balanceOf(rpc, creator, mint)) : null;
    return { at: Date.now(), supply: supply.value.uiAmount ?? 0, holders, creator: creator && creator !== ownWallet ? creator : null, creatorAmt };
  } catch { return null; }
}

// ─── Persisted baselines + per-position polling ──────────────────────────────
const file = () => process.env.HOLDER_BASELINE_STORE || path.join(process.cwd(), 'logs', 'holder-baselines.json');
let cache: Record<string, HolderSnap> | null = null;
function load(): Record<string, HolderSnap> { if (!cache) { try { cache = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { cache = {}; } } return cache!; }
function persist() { try { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(`${file()}.tmp`, JSON.stringify(load())); fs.renameSync(`${file()}.tmp`, file()); } catch { /* best effort */ } }
export function _resetHolderStore() { cache = null; lastPoll.clear(); inflight.clear(); pending.clear(); }

const lastPoll = new Map<string, number>();
const inflight = new Set<string>();
const pending = new Map<string, HolderSellHit>();

/** A detected sell waiting to be acted on by the monitor (consumed once). */
export function takeHolderExit(positionId: string): HolderSellHit | null { const h = pending.get(positionId) ?? null; pending.delete(positionId); return h; }

/** Fire-and-forget poll; at most one in flight per position and one per HOLDER_WATCH_SEC. */
export function pollHolders(pos: { id: string; mint: string; creator: string | null }, ownWallet: string | null, log: (msg: string) => void, now = Date.now(), rpc: Rpc = defaultRpc): Promise<void> | null {
  const every = Math.max(30, Number(process.env.HOLDER_WATCH_SEC ?? 120) || 120) * 1000;
  const last = lastPoll.get(pos.id);
  if (inflight.has(pos.id) || (last !== undefined && now - last < every)) return null;
  inflight.add(pos.id); lastPoll.set(pos.id, now);
  return (async () => {
    try {
      const store = load();
      const base = store[pos.id];
      const snap = await takeSnapshot(pos.mint, pos.creator, ownWallet, base ? Object.keys(base.holders) : [], rpc);
      if (!snap) return;
      if (!base) { store[pos.id] = snap; persist(); log(`holder watch baseline: creator ${snap.creator ? 'known' : 'unknown'}, ${Object.keys(snap.holders).length} top holders`); return; }
      const hit = holderSellDecision(base, snap);
      if (hit) pending.set(pos.id, hit);
    } catch { /* never throw into the monitor */ } finally { inflight.delete(pos.id); }
  })();
}

export function forgetPosition(positionId: string) { const s = load(); if (s[positionId]) { delete s[positionId]; persist(); } lastPoll.delete(positionId); pending.delete(positionId); }
