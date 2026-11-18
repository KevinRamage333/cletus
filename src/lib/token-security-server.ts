/**
 * Server-side fact gathering for Cletus Verified and Token Boost safety checks.
 * Sources: Solana JSON-RPC (mint + Metaplex metadata accounts, largest holders), DexScreener (pools),
 * GoPlus public token-security API (creator/owner, honeypot simulation, taxes, LP lock). All read-only, no keys.
 * Anything that cannot be read stays null/undefined so the rules treat it as "unknown", never as a pass.
 */
import { PublicKey } from '@solana/web3.js';
import { holderFacts } from './public-audit';
import { networkMeta, type ListingNetwork, type TokenSecurityFacts } from './verified';

const RPC = process.env.SOLANA_PUBLIC_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const METAPLEX = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const GOPLUS = 'https://api.gopluslabs.io/api/v1';
const BURN = new Set(['0x000000000000000000000000000000000000dead', '0x0000000000000000000000000000000000000000']);

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? 'RPC error');
  return j.result as T;
}
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
const num = (v: unknown): number | null => { const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN; return Number.isFinite(n) ? n : null; };

type DexPair = { chainId: string; baseToken: { address: string; name?: string; symbol?: string }; liquidity?: { usd?: number } };
async function deepestPool(network: ListingNetwork, token: string): Promise<DexPair | null> {
  const meta = networkMeta(network);
  if (!meta) return null;
  const pairs = await getJson<DexPair[]>(`https://api.dexscreener.com/tokens/v1/${meta.dexId}/${token}`);
  const mine = (Array.isArray(pairs) ? pairs : []).filter((p) => p.chainId === meta.dexId && p.baseToken?.address?.toLowerCase() === token.toLowerCase());
  return mine.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;
}

/** Metaplex metadata update authority: bytes 1..33 of the metadata account. */
export function updateAuthorityFromMetadata(data: Uint8Array): string | null {
  if (data.length < 65 || data[0] !== 4) return null; // Key::MetadataV1 = 4
  return new PublicKey(data.slice(1, 33)).toBase58();
}

type ParsedMint = { value: { owner: string; data: { parsed?: { type?: string; info?: { mintAuthority: string | null; freezeAuthority: string | null; supply: string; decimals: number; extensions?: Array<{ extension?: string; state?: Record<string, unknown> }> } } } } | null };
type GoPlusSol = { creators?: Array<{ address?: string }>; metadata_mutable?: { metadata_upgrade_authority?: Array<{ address?: string }> }; dex?: Array<{ tvl?: string; burn_percent?: number | null }>; transfer_fee?: { current_fee_rate?: { fee_rate?: string } } };

/** Token-2022 extensions that let someone other than the holder move, block or tax transfers (Audit M5). */
export function token2022Risks(ext: Array<{ extension?: string; state?: Record<string, unknown> }> | undefined): string[] {
  const out: string[] = [];
  for (const e of ext ?? []) {
    const st = e.state ?? {};
    if (e.extension === 'permanentDelegate' && st.delegate) out.push('Permanent delegate can move any holder\'s tokens.');
    if (e.extension === 'transferHook' && st.programId) out.push('Transfer hook program runs on every transfer.');
    if (e.extension === 'defaultAccountState' && String(st.accountState ?? '').toLowerCase() === 'frozen') out.push('New token accounts start frozen.');
    if (e.extension === 'nonTransferable') out.push('Token is non-transferable.');
    if (e.extension === 'pausableConfig' && st.paused === true) out.push('Transfers are paused.');
  }
  return out;
}

async function solanaFacts(token: string): Promise<TokenSecurityFacts> {
  const errors: string[] = [];
  const pda = PublicKey.findProgramAddressSync([Buffer.from('metadata'), METAPLEX.toBuffer(), new PublicKey(token).toBuffer()], METAPLEX)[0].toBase58();
  const [acct, largest, meta, pool, gp] = await Promise.allSettled([
    rpc<ParsedMint>('getAccountInfo', [token, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
    rpc<{ value: Array<{ address: string; uiAmount: number | null }> }>('getTokenLargestAccounts', [token, { commitment: 'confirmed' }]),
    rpc<{ value: { data: [string, string] } | null }>('getAccountInfo', [pda, { encoding: 'base64', commitment: 'confirmed' }]),
    deepestPool('solana', token),
    getJson<{ result?: Record<string, GoPlusSol> }>(`${GOPLUS}/solana/token_security?contract_addresses=${token}`),
  ]);
  const f: TokenSecurityFacts = { network: 'solana', token, name: null, symbol: null, controllers: [], top1Pct: null, top10Pct: null, liquidityUsd: null, lpLockedOrBurnedPct: null, honeypot: null, sellTaxPct: null, buyTaxPct: null, sources: ['Solana JSON-RPC', 'DexScreener', 'GoPlus Security'], errors };
  let supplyUi = 0;
  if (acct.status === 'fulfilled') {
    const info = acct.value?.value?.data?.parsed?.type === 'mint' ? acct.value.value.data.parsed.info : undefined;
    if (!info) throw Object.assign(new Error('That address is not an SPL token mint.'), { status: 400 });
    f.mintAuthority = info.mintAuthority; f.freezeAuthority = info.freezeAuthority;
    f.token2022Risks = token2022Risks(info.extensions);
    supplyUi = Number(info.supply) / 10 ** info.decimals;
    if (info.mintAuthority) f.controllers.push({ address: info.mintAuthority, role: 'mint authority' });
    if (info.freezeAuthority) f.controllers.push({ address: info.freezeAuthority, role: 'freeze authority' });
  } else errors.push('Solana RPC unavailable');
  if (meta.status === 'fulfilled' && meta.value?.value?.data?.[0]) {
    const ua = updateAuthorityFromMetadata(Buffer.from(meta.value.value.data[0], 'base64'));
    if (ua) f.controllers.push({ address: ua, role: 'metadata update authority' });
  }
  if (largest.status === 'fulfilled') { const h = holderFacts(largest.value.value, supplyUi); if (h) { f.top1Pct = h.top1Pct; f.top10Pct = h.top10Pct; } } else errors.push('Holder data unavailable');
  if (pool.status === 'fulfilled' && pool.value) { f.liquidityUsd = num(pool.value.liquidity?.usd); f.name = pool.value.baseToken.name ?? null; f.symbol = pool.value.baseToken.symbol ?? null; } else if (pool.status === 'rejected') errors.push('DexScreener unavailable');
  if (gp.status === 'fulfilled') {
    const g = gp.value.result?.[token];
    if (g) {
      for (const c of g.creators ?? []) if (c.address) f.controllers.push({ address: c.address, role: 'creator' });
      for (const c of g.metadata_mutable?.metadata_upgrade_authority ?? []) if (c.address) f.controllers.push({ address: c.address, role: 'metadata update authority' });
      const deepest = [...(g.dex ?? [])].sort((a, b) => (num(b.tvl) ?? 0) - (num(a.tvl) ?? 0))[0];
      if (deepest && deepest.burn_percent != null) f.lpLockedOrBurnedPct = num(deepest.burn_percent);
      const fee = num(g.transfer_fee?.current_fee_rate?.fee_rate);
      if (fee != null) { f.sellTaxPct = fee * 100; f.buyTaxPct = fee * 100; }
    }
  } else errors.push('GoPlus unavailable');
  f.controllers = dedupe(f.controllers, 'solana');
  return f;
}

type GoPlusEvm = { token_name?: string; token_symbol?: string; creator_address?: string; owner_address?: string; is_mintable?: string; owner_change_balance?: string; hidden_owner?: string; can_take_back_ownership?: string; is_honeypot?: string; cannot_sell_all?: string; buy_tax?: string; sell_tax?: string; holders?: Array<{ address?: string; percent?: string }>; lp_holders?: Array<{ address?: string; percent?: string; is_locked?: number }> };

async function evmFacts(network: ListingNetwork, token: string): Promise<TokenSecurityFacts> {
  const meta = networkMeta(network)!;
  const errors: string[] = [];
  const [gp, pool] = await Promise.allSettled([
    getJson<{ result?: Record<string, GoPlusEvm> }>(`${GOPLUS}/token_security/${meta.chainId}?contract_addresses=${token}`),
    deepestPool(network, token),
  ]);
  const f: TokenSecurityFacts = { network, token, name: null, symbol: null, controllers: [], ownerCanMint: null, top1Pct: null, top10Pct: null, liquidityUsd: null, lpLockedOrBurnedPct: null, honeypot: null, sellTaxPct: null, buyTaxPct: null, sources: ['GoPlus Security', 'DexScreener'], errors };
  if (pool.status === 'fulfilled' && pool.value) { f.liquidityUsd = num(pool.value.liquidity?.usd); f.name = pool.value.baseToken.name ?? null; f.symbol = pool.value.baseToken.symbol ?? null; } else if (pool.status === 'rejected') errors.push('DexScreener unavailable');
  const g = gp.status === 'fulfilled' ? gp.value.result?.[token.toLowerCase()] : undefined;
  if (gp.status === 'rejected') errors.push('GoPlus unavailable');
  if (g) {
    f.name ??= g.token_name ?? null; f.symbol ??= g.token_symbol ?? null;
    if (g.owner_address && !BURN.has(g.owner_address.toLowerCase())) f.controllers.push({ address: g.owner_address, role: 'contract owner' });
    if (g.creator_address) f.controllers.push({ address: g.creator_address, role: 'deployer' });
    const flags = [g.is_mintable, g.owner_change_balance, g.hidden_owner, g.can_take_back_ownership];
    f.ownerCanMint = flags.every((x) => x == null) ? null : flags.some((x) => x === '1');
    f.honeypot = g.is_honeypot == null ? null : g.is_honeypot === '1' || g.cannot_sell_all === '1';
    const bt = num(g.buy_tax), st = num(g.sell_tax);
    f.buyTaxPct = bt == null ? null : bt * 100; f.sellTaxPct = st == null ? null : st * 100;
    const hs = (g.holders ?? []).map((h) => (num(h.percent) ?? 0) * 100);
    if (hs.length) { f.top1Pct = hs[0]; f.top10Pct = hs.slice(0, 10).reduce((s, x) => s + x, 0); }
    if (g.lp_holders?.length) f.lpLockedOrBurnedPct = g.lp_holders.filter((h) => h.is_locked === 1 || BURN.has(String(h.address).toLowerCase())).reduce((s, h) => s + (num(h.percent) ?? 0) * 100, 0);
  } else if (gp.status === 'fulfilled') errors.push('GoPlus has no data for this contract');
  f.controllers = dedupe(f.controllers, network);
  return f;
}

function dedupe(list: TokenSecurityFacts['controllers'], network: ListingNetwork) {
  const seen = new Map<string, { address: string; role: string }>();
  for (const c of list) {
    const k = network === 'solana' ? c.address : c.address.toLowerCase();
    const prev = seen.get(k);
    seen.set(k, prev ? { ...prev, role: prev.role.includes(c.role) ? prev.role : `${prev.role}, ${c.role}` } : c);
  }
  return Array.from(seen.values());
}

export async function gatherTokenFacts(network: ListingNetwork, token: string): Promise<TokenSecurityFacts> {
  return network === 'solana' ? solanaFacts(token) : evmFacts(network, token);
}
