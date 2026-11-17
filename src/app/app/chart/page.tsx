'use client';
/** Chart: search any Solana token (symbol, name, or address) and see real-time candles, embeds, and Cletus's trades. Route: /app/chart */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import TokenChart from '@/components/TokenChart';

/* eslint-disable @typescript-eslint/no-explicit-any */
function ChartInner() {
  const sp = useSearchParams();
  const [q, setQ] = useState('');
  const [network, setNetwork] = useState(sp.get('network') ?? 'solana');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<{ address: string; pool?: string | null } | null>(sp.get('address') ? { address: sp.get('address')!, pool: sp.get('pool') } : null);
  const [quick, setQuick] = useState<{ label: string; address: string; pool?: string | null; kind: string }[]>([]);

  useEffect(() => {
    if (network !== 'solana') return;
    (async () => {
      const [t, s] = await Promise.all([
        fetch('/api/protected/trade/session', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/signals?limit=8', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const list = [
        ...((t?.openPositions ?? []) as any[]).map((p) => ({ label: p.symbol, address: p.mint, pool: null as string | null, kind: 'position' })),
        ...((s?.signals ?? []) as any[]).filter((x) => !String(x.status).startsWith('filtered')).map((x) => ({ label: x.base, address: x.id, pool: x.pool, kind: 'signal' })),
      ];
      const seen = new Set<string>();
      const uniq = list.filter((x) => !seen.has(x.address) && seen.add(x.address));
      setQuick(uniq);
      setSel((cur) => cur ?? (uniq[0] ? { address: uniq[0].address, pool: uniq[0].pool } : { address: 'So11111111111111111111111111111111111111112' }));
    })();
  }, [network]);

  const search = useCallback(async () => {
    const term = q.trim();
    if (!term) return;
    setSearching(true); setErr(null);
    try {
      if (network !== 'solana') { setSel({ address: term }); setResults([]); return; }
      const r = await fetch(`/api/tokens/search?q=${encodeURIComponent(term)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'search failed');
      setResults(d.tokens ?? []);
      if (!d.tokens?.length) setErr('No Solana pools found for that search.');
      else if (d.tokens.length === 1) { setSel({ address: d.tokens[0].address, pool: d.tokens[0].pool }); setResults([]); }
    } catch (e) { setErr((e as Error).message); } finally { setSearching(false); }
  }, [q, network]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="border-b border-white/10 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-2.5">
          <img src="/cletus-logo.png" alt="Cletus" width={36} height={36} className="rounded-full" />
          <div><div className="font-bold text-lg leading-none gold-text">Cletus</div><div className="text-xs text-white/50 mt-0.5">Chart · real-time</div></div>
        </div>
      </header>
      <main className="flex-1 px-4 sm:px-6 py-5">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="flex gap-2 flex-wrap"><label className="text-xs text-[#E5C76B] self-center" htmlFor="chart-network">Network</label><select id="chart-network" value={network} onChange={e=>{setNetwork(e.target.value);setSel(null);setResults([]);setErr(null);setQ('')}} className="rounded-xl border border-[#D4AF37]/40 bg-[#121212] px-3 py-2 text-sm text-white">{[['solana','Solana'],['ethereum','Ethereum'],['base','Base'],['bsc','BNB Chain'],['arbitrum','Arbitrum'],['polygon','Polygon'],['avalanche','Avalanche']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder={network==='solana'?'Token/pool address or symbol (e.g. BONK)':'Paste a 0x token or pool address'} className="flex-1 text-sm px-3 py-2.5 rounded-xl bg-[#121212] border border-white/10 focus:outline-none focus:border-emerald-500/50" />
            <button onClick={search} disabled={searching} className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-emerald-500 text-black disabled:opacity-50">{searching ? '…' : 'Chart'}</button>
          </div>
          {err && <p className="text-xs text-red-400">{err}</p>}
          {results.length > 1 && (
            <div className="rounded-xl border border-white/10 bg-[#121212] divide-y divide-white/5">
              {results.map((t) => (
                <button key={t.address} onClick={() => { setSel({ address: t.address, pool: t.pool }); setResults([]); }} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/5">
                  {t.image ? <img src={t.image} alt="" width={20} height={20} className="rounded-full" /> : <span className="w-5" />}
                  <span className="font-semibold text-sm">{t.symbol}</span><span className="text-xs text-white/40 truncate">{t.name}</span>
                  <span className="ml-auto text-xs font-mono text-white/50">liq ${Math.round(t.liquidityUsd ?? 0).toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
          {network === 'solana' && quick.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {quick.map((x) => (
                <button key={x.address} onClick={() => setSel({ address: x.address, pool: x.pool })} className={`px-2.5 py-1 rounded-full text-xs border ${sel?.address === x.address ? 'border-emerald-500 text-emerald-400' : 'border-white/10 text-white/60'}`}>{x.kind === 'position' ? '● ' : ''}{x.label}</button>
              ))}
              <span className="text-[10px] text-white/30 self-center">● = your open position · others from the live scanner</span>
            </div>
          )}
          {sel && <TokenChart key={`${network}:${sel.address}:${sel.pool ?? ''}`} address={sel.address} pool={network==='solana'?sel.pool:null} apiBase={network==='solana'?'/api/tokens/chart':`/api/tokens/chart-evm?network=${network}&unused=1`} />}
          {network!=='solana'&&<p className="text-xs text-amber-300">EVM charts are read-only. Enter a token or pool contract; no EVM trade markers or live execution are implied.</p>}
          <p className="text-[11px] text-white/25 text-center">Market data: GeckoTerminal and DexScreener. Not financial advice.</p>
        </div>
      </main>
    </div>
  );
}

export default function ChartPage() {
  return <Suspense fallback={<div className="p-6 text-white/50">Loading chart…</div>}><ChartInner /></Suspense>;
}
