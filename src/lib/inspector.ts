/** Dev Wallet Inspector: live view of any Solana wallet or token mint via Helius (RPC, DAS, enhanced transactions). Read-only. */
import { PublicKey } from '@solana/web3.js';
import { rpcCall } from './rpc-pool';

export const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];

export function parseAddress(input: string): string | null {
  const s = (input || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return null;
  try { return new PublicKey(s).toBase58(); } catch { return null; }
}

export interface Holding { mint: string; symbol: string | null; name: string | null; amount: number; valueUsd: number | null; priceUsd: number | null }
export interface TxSummary { signature: string; time: string | null; type: string; description: string | null; failed: boolean; feeSol: number | null; counterparties?: string[] }
export interface Inspection {
  address: string; kind: 'wallet' | 'token' | 'program' | 'other'; fetchedAt: string; source: string[];
  solBalance: number | null; holdings: Holding[]; holdingsTotalUsd: number | null; transactions: TxSummary[];
  token?: { decimals: number; supply: number; mintAuthority: string | null; freezeAuthority: string | null; topHolders: { owner: string; pct: number }[]; priceUsd: number | null; marketCap: number | null; liquidityUsd: number | null; symbol: string | null; name: string | null; pairUrl: string | null };
  errors: string[];
}

const heliusKey = () => { const k = process.env.HELIUS_API_KEY; return k && !k.includes('your_') ? k : null; };

/** Map a Helius DAS getAssetsByOwner response to holdings (fungible only). Pure; exported for tests. */
export function holdingsFromDas(res: unknown): Holding[] {
  const items = ((res as { items?: unknown[] })?.items ?? []) as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: Holding[] = [];
  for (const it of items) {
    const ti = it.token_info;
    if (!ti || ti.balance === undefined) continue;
    const amount = Number(ti.balance) / 10 ** Number(ti.decimals ?? 0);
    if (!(amount > 0)) continue;
    const price = ti.price_info?.price_per_token ?? null;
    out.push({ mint: it.id, symbol: ti.symbol ?? it.content?.metadata?.symbol ?? null, name: it.content?.metadata?.name ?? null, amount, priceUsd: price, valueUsd: ti.price_info?.total_price ?? (price !== null ? price * amount : null) });
  }
  return out.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
}

/** Map Helius enhanced transactions to summaries. Pure; exported for tests. */
export function txsFromEnhanced(rows: unknown): TxSummary[] {
  return ((Array.isArray(rows) ? rows : []) as Array<Record<string, any>>).map((t) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    signature: String(t.signature), time: t.timestamp ? new Date(t.timestamp * 1000).toISOString() : null, type: String(t.type ?? 'UNKNOWN'),
    description: t.description || null, failed: !!t.transactionError, feeSol: typeof t.fee === 'number' ? t.fee / 1e9 : null,
    counterparties: [...new Set([...(t.nativeTransfers ?? []), ...(t.tokenTransfers ?? [])].flatMap((x: any) => [x.fromUserAccount, x.toUserAccount]).filter(Boolean))] as string[], // eslint-disable-line @typescript-eslint/no-explicit-any
  }));
}

const cache = new Map<string, { at: number; v: Inspection }>();

export async function inspectAddress(address: string): Promise<Inspection> {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const r: Inspection = { address, kind: 'other', fetchedAt: new Date().toISOString(), source: [], solBalance: null, holdings: [], holdingsTotalUsd: null, transactions: [], errors: [] };
  const safe = async <T>(label: string, f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch (e) { r.errors.push(`${label}: ${String((e as Error).message).replace(/https?:\/\/\S+/g, '[url]').slice(0, 120)}`); return null; } };

  type AccInfo = { value: { owner: string; executable: boolean; lamports: number; data: { parsed?: { type?: string; info?: Record<string, any> } } | unknown } | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const info = await safe('account', () => rpcCall<AccInfo>('getAccountInfo', [address, { encoding: 'jsonParsed' }]));
  const v = info?.value;
  r.solBalance = v ? v.lamports / 1e9 : 0;
  r.source.push('Solana RPC');
  const parsed = (v?.data as { parsed?: { type?: string; info?: Record<string, any> } })?.parsed; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (v && TOKEN_PROGRAMS.includes(v.owner) && parsed?.type === 'mint') r.kind = 'token';
  else if (v?.executable) r.kind = 'program';
  else if (!v || v.owner === '11111111111111111111111111111111') r.kind = 'wallet';

  if (r.kind === 'token' && parsed?.info) {
    const i = parsed.info; const decimals = Number(i.decimals); const supply = Number(i.supply) / 10 ** decimals;
    const largest = await safe('holders', () => rpcCall<{ value: { address: string; uiAmount: number }[] }>('getTokenLargestAccounts', [address]));
    if (largest) r.source.push('Solana RPC largest token accounts');
    let top: { owner: string; pct: number }[] = [];
    if (largest?.value?.length) {
      const accs = largest.value.slice(0, 10);
      const owners = await safe('owners', () => rpcCall<{ value: ({ data: { parsed?: { info?: { owner?: string } } } } | null)[] }>('getMultipleAccounts', [accs.map((a) => a.address), { encoding: 'jsonParsed' }]));
      top = accs.map((a, k) => ({ owner: owners?.value?.[k]?.data?.parsed?.info?.owner ?? a.address, pct: supply > 0 ? (a.uiAmount / supply) * 100 : 0 }));
    }
    let market: { priceUsd: number | null; marketCap: number | null; liquidityUsd: number | null; symbol: string | null; name: string | null; pairUrl: string | null } = { priceUsd: null, marketCap: null, liquidityUsd: null, symbol: null, name: null, pairUrl: null };
    const dx = await safe('dexscreener', async () => {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${address}`, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
      return res.ok ? ((await res.json()) as Array<Record<string, any>>) : []; // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    const best = (dx ?? []).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (best) { market = { priceUsd: Number(best.priceUsd) || null, marketCap: best.marketCap ?? best.fdv ?? null, liquidityUsd: best.liquidity?.usd ?? null, symbol: best.baseToken?.symbol ?? null, name: best.baseToken?.name ?? null, pairUrl: best.url ?? null }; r.source.push('DexScreener'); }
    r.token = { decimals, supply, mintAuthority: i.mintAuthority ?? null, freezeAuthority: i.freezeAuthority ?? null, topHolders: top, ...market };
  } else {
    const das = await safe('holdings', () => rpcCall<unknown>('getAssetsByOwner', { ownerAddress: address, page: 1, limit: 100, displayOptions: { showFungible: true, showZeroBalance: false } }, { only: 'helius' }));
    if (das) { r.holdings = holdingsFromDas(das); r.source.push('Helius DAS'); }
    else {
      for (const programId of TOKEN_PROGRAMS) {
        const ta = await safe('token accounts', () => rpcCall<{ value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number } } } } } }[] }>('getTokenAccountsByOwner', [address, { programId }, { encoding: 'jsonParsed' }]));
        for (const x of ta?.value ?? []) { const ii = x.account.data.parsed.info; if (ii.tokenAmount.uiAmount > 0) r.holdings.push({ mint: ii.mint, symbol: null, name: null, amount: ii.tokenAmount.uiAmount, priceUsd: null, valueUsd: null }); }
      }
    }
    const priced = r.holdings.filter((h) => h.valueUsd !== null);
    r.holdingsTotalUsd = priced.length ? priced.reduce((s, h) => s + (h.valueUsd ?? 0), 0) : null;
  }

  const key = heliusKey();
  let txs: TxSummary[] | null = null;
  if (key) {
    txs = await safe('transactions', async () => {
      const res = await fetch(`https://api-mainnet.helius-rpc.com/v0/addresses/${address}/transactions?api-key=${encodeURIComponent(key)}&limit=15`, { signal: AbortSignal.timeout(12000), cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return txsFromEnhanced(await res.json());
    });
    if (txs) r.source.push('Helius enhanced transactions');
  }
  if (!txs) {
    const sigs = await safe('signatures', () => rpcCall<{ signature: string; blockTime: number | null; err: unknown; memo: string | null }[]>('getSignaturesForAddress', [address, { limit: 15 }]));
    txs = (sigs ?? []).map((s) => ({ signature: s.signature, time: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null, type: 'TRANSACTION', description: s.memo, failed: !!s.err, feeSol: null }));
  }
  r.transactions = txs;
  cache.set(address, { at: Date.now(), v: r });
  return r;
}
