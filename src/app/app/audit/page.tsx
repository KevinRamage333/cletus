'use client';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { PageHeader, Refreshed, StateBox, Stat, TokenAvatar } from '@/components/app/ui';
import { formatPct, formatPrice, formatUsdCompact, type MoverCard } from '@/lib/movers';
import { BASE58_MINT, type CheckState, type HolderFacts, type PublicAuditCheck } from '@/lib/public-audit';

type Audit = { mint: string; auditedAt: string; facts: { mintAuthority: string | null; freezeAuthority: string | null; decimals: number; supplyUi: number; program: string } | null; holders: HolderFacts | null; market: MoverCard | null; checks: PublicAuditCheck[]; verdict: { label: string; state: CheckState }; errors: string[]; sources: string[]; disclaimer: string };
const STATE: Record<CheckState, string> = { pass: 'text-green-300 border-green-400/40', warn: 'text-[#f3dc95] border-[#e3c06a]/50', fail: 'text-red-300 border-red-400/50', unknown: 'text-sky-200 border-sky-300/40' };
const LABEL: Record<CheckState, string> = { pass: 'Pass', warn: 'Caution', fail: 'Risk', unknown: 'Unverified' };
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function AuditInner() {
  const sp = useSearchParams(); const router = useRouter();
  const [input, setInput] = useState('');
  const [data, setData] = useState<Audit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const run = useCallback(async (mint: string) => {
    if (!BASE58_MINT.test(mint)) { setErr('Enter a valid Solana mint address.'); return; }
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/market/audit?mint=${mint}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message || `Audit failed (HTTP ${res.status})`);
      setData(j);
    } catch (e) { setData(null); setErr(e instanceof Error ? e.message : 'Audit failed'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const m = sp?.get('mint'); if (m) { setInput(m); void run(m); } }, [sp, run]);
  const submit = (e: React.FormEvent) => { e.preventDefault(); router.replace(`/app/audit?mint=${input.trim()}`); void run(input.trim()); };
  const m = data?.market;
  return (
    <div>
      <PageHeader eyebrow="Cletus Audit" title="Token security check" actions={data ? <Refreshed at={data.auditedAt} label="Audited" /> : undefined}>
        Mint and freeze authority, holder concentration and liquidity, read live from Solana RPC and DexScreener. Heuristics, not guarantees.
      </PageHeader>
      <form onSubmit={submit} className="mb-6 flex flex-col gap-2 sm:flex-row">
        <input className="field num text-xs" placeholder="Solana token mint address" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Token mint" data-testid="audit-input" />
        <button className="btn-gold sm:w-40" disabled={loading} data-testid="audit-run">{loading ? 'Auditing…' : 'Run audit'}</button>
      </form>
      {loading && <div className="space-y-3" data-testid="audit-loading"><div className="skeleton h-20" /><div className="skeleton h-40" /></div>}
      {err && !loading && <StateBox kind="error" title="Audit could not complete">{err}</StateBox>}
      {!data && !loading && !err && <StateBox kind="empty" title="Paste a mint, or open Audit from any token card on the Signals board" action={<Link href="/app/signals" className="btn-line !py-1.5">Signals</Link>} />}
      {data && !loading && (
        <div className="space-y-6" data-testid="audit-result">
          <div className={`panel flex flex-wrap items-center gap-4 border p-5 ${STATE[data.verdict.state]}`}>
            {m && <TokenAvatar src={m.imageUrl} symbol={m.symbol} size={52} />}
            <div className="min-w-0 flex-1"><p className="text-lg font-bold text-[#f6f1e4]">{m ? `${m.name} ($${m.symbol})` : short(data.mint)}</p><p className="num break-all text-[11px] text-[#8a8478]">{data.mint}</p></div>
            <p className="text-sm font-bold uppercase tracking-[.14em]" data-testid="audit-verdict">{data.verdict.label}</p>
          </div>
          {data.errors.length > 0 && <StateBox kind="stale" title="Some sources did not respond">{data.errors.join(' · ')}</StateBox>}
          <div className="grid gap-3 md:grid-cols-2">
            {data.checks.map((c) => <div key={c.id} className="panel p-4" data-testid="audit-check"><div className="flex items-center justify-between gap-2"><p className="font-semibold text-[#f6f1e4]">{c.label}</p><span className={`border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATE[c.state]}`}>{LABEL[c.state]}</span></div><p className="mt-1 break-words text-xs text-[#a39c8f]">{c.detail}</p></div>)}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Price" value={formatPrice(m?.priceUsd)} /><Stat label="Market cap" value={formatUsdCompact(m?.marketCapUsd)} /><Stat label="Liquidity" value={formatUsdCompact(m?.liquidityUsd)} /><Stat label="24h change" value={formatPct(m?.change24hPct)} tone={m?.change24hPct == null ? 'muted' : m.change24hPct >= 0 ? 'up' : 'down'} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="panel p-5"><h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Mint facts</h3>
              {data.facts ? <dl className="num mt-3 grid grid-cols-2 gap-y-2 text-xs"><dt className="text-[#8a8478]">Program</dt><dd>{data.facts.program}</dd><dt className="text-[#8a8478]">Decimals</dt><dd>{data.facts.decimals}</dd><dt className="text-[#8a8478]">Supply</dt><dd>{data.facts.supplyUi.toLocaleString('en-US', { maximumFractionDigits: 0 })}</dd><dt className="text-[#8a8478]">Mint authority</dt><dd className="break-all">{data.facts.mintAuthority ?? 'revoked'}</dd><dt className="text-[#8a8478]">Freeze authority</dt><dd className="break-all">{data.facts.freezeAuthority ?? 'revoked'}</dd></dl> : <div className="mt-3"><StateBox kind="not-connected" title="Mint account not readable right now" /></div>}
            </section>
            <section className="panel p-5"><h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Largest token accounts</h3>
              {data.holders ? <ol className="num mt-3 space-y-1 text-xs">{data.holders.topAccounts.slice(0, 10).map((h, i) => <li key={h.address} className="flex justify-between gap-2"><span className="text-[#8a8478]">{i + 1}. {short(h.address)}</span><span>{h.pct.toFixed(2)}%</span></li>)}</ol> : <div className="mt-3"><StateBox kind="not-connected" title="Holder data unavailable">The public RPC may rate-limit this call. Try again shortly.</StateBox></div>}
              <p className="mt-3 text-[11px] text-[#8a8478]">Accounts can include liquidity pools and exchanges.</p>
            </section>
          </div>
          <p className="text-[11px] text-[#8a8478]">{data.disclaimer} Sources: {data.sources.join(', ')}.</p>
        </div>
      )}
    </div>
  );
}
export default function AuditPage() { return <Suspense fallback={<div className="skeleton h-40" />}><AuditInner /></Suspense>; }
