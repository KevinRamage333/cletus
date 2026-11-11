'use client';
import { useState } from 'react';
import TokenChart from '@/components/TokenChart';

const PICKS = [
  { s: 'SOL', a: 'So11111111111111111111111111111111111111112' },
  { s: 'BONK', a: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
  { s: 'JUP', a: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
  { s: 'WIF', a: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
];
type Hit = { symbol: string; name: string; address: string; pool: string; priceUsd: number | null };

export default function DemoChart() {
  const [addr, setAddr] = useState(PICKS[1].a);
  const [pool, setPool] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const search = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const r = await fetch(`/api/demo/search?q=${encodeURIComponent(q)}`); const d = await r.json();
    if (!r.ok) return setErr(d.error ?? 'search failed');
    setHits(d.tokens ?? []); if (!d.tokens?.length) setErr('No Solana tokens found');
  };
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold gold-text">Live Solana charts</h1>
      <p className="text-sm text-zinc-400">Real-time candles from GeckoTerminal (cached and rate-limited), with GeckoTerminal and DexScreener embeds. Search by symbol, token mint or pool address.</p>
      <form onSubmit={search} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol, mint or pool address" className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white" />
        <button className="px-4 py-2 rounded-lg bg-amber-400 text-black font-semibold">Search</button>
      </form>
      {err && <div className="text-sm text-red-400">{err}</div>}
      {hits.length > 0 && (
        <div className="flex flex-wrap gap-2">{hits.map((h) => (
          <button key={h.pool} onClick={() => { setAddr(h.address); setPool(h.pool); setHits([]); }} className="px-3 py-1 rounded-full border border-zinc-700 text-sm text-zinc-200 hover:border-amber-400">
            {h.symbol} <span className="text-zinc-500">{h.priceUsd != null ? `$${h.priceUsd}` : ''}</span>
          </button>))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">{PICKS.map((p) => (
        <button key={p.s} onClick={() => { setAddr(p.a); setPool(null); }} className={`px-3 py-1 rounded-full border text-sm ${addr === p.a ? 'border-amber-400 text-amber-300' : 'border-zinc-700 text-zinc-300'}`}>{p.s}</button>))}
      </div>
      <TokenChart key={addr + (pool ?? '')} address={addr} pool={pool} apiBase="/api/demo/chart" height={460} />
    </div>
  );
}
