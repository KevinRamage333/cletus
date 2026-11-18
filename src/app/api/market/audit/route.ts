import { NextResponse } from 'next/server';
import { fetchSolanaPairs } from '@/lib/movers-server';
import { bestPairs, toMoverCard } from '@/lib/movers';
import { BASE58_MINT, auditVerdict, evaluatePublicAudit, holderFacts, type MintFacts } from '@/lib/public-audit';
export const dynamic = 'force-dynamic';

const RPC = process.env.SOLANA_PUBLIC_RPC || process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PKoKwKxH5HTLjn';

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const j = await res.json() as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? 'RPC error');
  return j.result as T;
}

type ParsedMint = { value: { owner: string; data: { parsed?: { type?: string; info?: { mintAuthority: string | null; freezeAuthority: string | null; supply: string; decimals: number } } } } | null };
type Largest = { value: Array<{ address: string; uiAmount: number | null }> };

/** Public, read-only token audit from Solana RPC + DexScreener. */
export async function GET(req: Request) {
  const mint = (new URL(req.url).searchParams.get('mint') ?? '').trim();
  if (!BASE58_MINT.test(mint)) return NextResponse.json({ error: 'invalid_mint', message: 'Enter a valid Solana mint address.' }, { status: 400 });
  const errors: string[] = [];
  const [acct, largest, pairs] = await Promise.allSettled([
    rpc<ParsedMint>('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
    rpc<Largest>('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]),
    fetchSolanaPairs([mint]),
  ]);
  let facts: MintFacts | null = null;
  if (acct.status === 'fulfilled') {
    const v = acct.value?.value;
    const info = v?.data?.parsed?.type === 'mint' ? v.data.parsed.info : undefined;
    if (!v) return NextResponse.json({ error: 'not_found', message: 'No account exists at that address.' }, { status: 404 });
    if (!info) return NextResponse.json({ error: 'not_a_mint', message: 'That address is not an SPL token mint.' }, { status: 400 });
    facts = { mintAuthority: info.mintAuthority, freezeAuthority: info.freezeAuthority, supplyRaw: info.supply, decimals: info.decimals, program: v.owner === TOKEN_PROGRAM ? 'spl-token' : v.owner === TOKEN_2022 ? 'token-2022' : 'unknown' };
  } else errors.push(`Solana RPC: ${acct.reason instanceof Error ? acct.reason.message : 'unavailable'}`);
  const supplyUi = facts ? Number(facts.supplyRaw) / 10 ** facts.decimals : 0;
  const holders = largest.status === 'fulfilled' ? holderFacts(largest.value.value, supplyUi) : null;
  if (largest.status === 'rejected') errors.push(`Holder data: ${largest.reason instanceof Error ? largest.reason.message : 'unavailable'}`);
  const pair = pairs.status === 'fulfilled' ? bestPairs(pairs.value).get(mint) : undefined;
  if (pairs.status === 'rejected') errors.push('DexScreener unavailable');
  const market = pair ? toMoverCard(pair) : null;
  const checks = evaluatePublicAudit(facts, holders, market?.liquidityUsd ?? null);
  return NextResponse.json({
    mint, auditedAt: new Date().toISOString(), facts: facts ? { ...facts, supplyUi } : null, holders, market, checks, verdict: auditVerdict(checks), errors,
    sources: ['Solana JSON-RPC (public)', 'DexScreener public API'], disclaimer: 'Heuristic checks on public data. They can be wrong and are not a recommendation.',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
