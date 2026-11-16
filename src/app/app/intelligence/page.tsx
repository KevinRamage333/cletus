'use client';

import { useState } from 'react';
import Link from 'next/link';

type FlowIntel = {
  status: { enabled: boolean; xEnabled: boolean; heliusCreditsToday: number; watchedWallets: number; whaleTicks?: number; lastError?: string | null };
  flow: { found: boolean; note?: string; summary?: string; features?: { whaleNetUsd: number; smartBuyUsd: number; smartSellUsd: number; devSoldUsd: number; freshCluster: { buyers: number; totalUsd: number } | null }; bigMovers?: Array<{ side: string; usd: number; wallet: string; tag: string | null; time: string; solscan: string }> };
  social: { found: boolean; note?: string; message?: string; divergence?: string };
  disclaimer: string;
};

type Intelligence = {
  mint: string;
  fetchedAt: string;
  identity: { name: string | null; symbol: string | null; decimals: number | null; supply: number | null; mintAuthority: string | null; freezeAuthority: string | null };
  market: null | { pairAddress: string; dex: string; priceUsd: number | null; marketCapUsd: number | null; liquidityUsd: number | null; volume: Record<string, number>; priceChange: Record<string, number>; transactions: Record<string, { buys: number; sells: number }> | null; pairCreatedAt: number | null; pairUrl: string | null };
  signals: Record<string, number> | null;
  compositeScore: number | null;
  scoreMode: string;
  security: { audit: null | { passed: boolean; riskScore: number | null; liquidityUsd: number | null; topHolderPct: number | null; checks: Array<{ name: string; passed: boolean; detail: string }> }; auditError: string | null; topHoldersSource?: string; authorityDataAvailable?: boolean; holderConcentration: Array<{ owner: string; pct: number }>; sources: string[]; warnings: string[] };
  activity: { transactions: Array<{ signature: string; time: string | null; type: string; description: string | null; failed: boolean }>; source: string };
  disclaimer: string;
};

const usd = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 8 : 2 }).format(n);
const pct = (n: number | null | undefined) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const label = (s: string) => s.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase());

export default function TokenIntelligencePage() {
  const [mint, setMint] = useState('');
  const [data, setData] = useState<Intelligence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [flowData, setFlowData] = useState<FlowIntel | null>(null);
  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(''); setData(null); setFlowData(null);
    try {
      const r = await fetch(`/api/tokens/intelligence?mint=${encodeURIComponent(mint.trim())}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Token intelligence unavailable');
      setData(j);
      const flowResponse = await fetch(`/api/tokens/flow?mint=${encodeURIComponent(mint.trim())}`, { cache: 'no-store' });
      if (flowResponse.ok) setFlowData(await flowResponse.json());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  return <main className="min-h-screen bg-black text-white px-4 py-6 sm:px-8">
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div><Link href="/app" className="text-sm text-amber-300 hover:underline">← Cletus dashboard</Link><h1 className="text-2xl font-bold mt-2">Token Intelligence</h1><p className="text-sm text-white/45">Multi-source research, signal breakdown, and pre-trade security checks.</p></div>
        <span className="text-xs text-white/40">SOLANA · READ ONLY</span>
      </header>
      <form onSubmit={analyze} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex flex-col sm:flex-row gap-3">
        <input value={mint} onChange={e => setMint(e.target.value)} placeholder="Paste a Solana token mint address" className="flex-1 min-w-0 rounded-lg bg-black border border-white/15 px-3 py-3 text-sm font-mono outline-none focus:border-amber-400" />
        <button disabled={loading || !mint.trim()} className="rounded-lg bg-amber-400 text-black font-semibold px-5 py-3 disabled:opacity-40">{loading ? 'Analyzing…' : 'Analyze token'}</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {data && <>
        <section className="rounded-2xl border border-white/10 bg-[#101010] p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{data.identity.name || 'Unknown token'} {data.identity.symbol && <span className="text-amber-300">({data.identity.symbol})</span>}</h2><p className="text-xs font-mono text-white/40 break-all">{data.mint}</p></div><div className="text-right"><div className="text-xs text-white/40">Cletus composite · {data.scoreMode}</div><div className="text-3xl font-bold">{data.compositeScore == null ? '—' : `${data.compositeScore}/100`}</div></div></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[['Price',usd(data.market?.priceUsd)],['Market cap',usd(data.market?.marketCapUsd)],['Liquidity',usd(data.market?.liquidityUsd)],['24h volume',usd(data.market?.volume.h24)]].map(([k,v])=><div key={k} className="rounded-lg bg-white/[0.04] p-3"><div className="text-xs text-white/40">{k}</div><div className="font-mono mt-1">{v}</div></div>)}</div>
          {data.market?.pairUrl && <a className="text-xs text-amber-300 underline" href={data.market.pairUrl} target="_blank" rel="noreferrer">Open market pair</a>}
        </section>
        <section className="rounded-2xl border border-white/10 bg-[#101010] p-5 space-y-3">
          <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Whale & smart-money flow</h3><span className="text-[10px] text-white/35">{flowData?.status.enabled ? (flowData.status.whaleTicks ? 'COLLECTOR ACTIVE' : 'DATABASE READY · WAITING') : 'COLLECTOR OFF'}</span></div>
          {!flowData ? <p className="text-sm text-white/40">Flow snapshot unavailable.</p> : !flowData.flow.found ? <p className="text-sm text-white/45">{flowData.flow.note || 'No recent flow snapshot for this token.'}</p> : <>
            <p className="text-sm text-white/75">{flowData.flow.summary}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg bg-white/[0.04] p-3"><div className="text-xs text-white/40">Whale net</div><div className="font-mono mt-1">{usd(flowData.flow.features?.whaleNetUsd ?? null)}</div></div>
              <div className="rounded-lg bg-white/[0.04] p-3"><div className="text-xs text-white/40">Smart buys</div><div className="font-mono mt-1">{usd(flowData.flow.features?.smartBuyUsd ?? null)}</div></div>
              <div className="rounded-lg bg-white/[0.04] p-3"><div className="text-xs text-white/40">Smart sells</div><div className="font-mono mt-1">{usd(flowData.flow.features?.smartSellUsd ?? null)}</div></div>
              <div className="rounded-lg bg-white/[0.04] p-3"><div className="text-xs text-white/40">Dev sells</div><div className="font-mono mt-1">{usd(flowData.flow.features?.devSoldUsd ?? null)}</div></div>
            </div>
            {flowData.flow.features?.freshCluster && <p className="text-xs text-amber-200">Possible coordinated fresh-wallet cluster: {flowData.flow.features.freshCluster.buyers} wallets · {usd(flowData.flow.features.freshCluster.totalUsd)}.</p>}
            <div className="space-y-2">{(flowData.flow.bigMovers ?? []).map((m,i)=><div key={i} className="flex flex-wrap justify-between gap-2 text-xs border-t border-white/5 pt-2"><span className={m.side === 'buy' ? 'text-emerald-300' : 'text-red-300'}>{m.side.toUpperCase()} · {usd(m.usd)}{m.tag ? ' · ' + m.tag : ''}</span><a href={m.solscan} target="_blank" rel="noreferrer" className="text-amber-300 underline">{m.wallet.slice(0,6)}…{m.wallet.slice(-5)}</a></div>)}</div>
          </>}
          <div className="border-t border-white/5 pt-3"><div className="text-xs text-white/50">Social activity</div><p className="text-sm text-white/70 mt-1">{flowData?.social.found ? flowData.social.message || flowData.social.divergence : flowData?.social.note || 'No social data available.'}</p></div>
          <p className="text-[11px] text-white/35">{flowData?.disclaimer || 'Flow data is optional and may be incomplete.'} {flowData?.status.watchedWallets ?? 0} watched wallets · {flowData?.status.heliusCreditsToday ?? 0} Helius credits used today · {flowData?.status.whaleTicks ?? 0} collection cycles. {flowData?.status.lastError ? `Latest collector error: ${flowData.status.lastError}` : ''}</p>
        </section>
        <section className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-white/10 bg-[#101010] p-5"><h3 className="font-semibold mb-3">Signal breakdown</h3>{data.signals ? <div className="space-y-3">{Object.entries(data.signals).map(([k,v])=><div key={k}><div className="flex justify-between text-xs mb-1"><span className="text-white/65">{label(k)}</span><span className="font-mono">{v}/100</span></div><div className="h-1.5 rounded bg-white/10 overflow-hidden"><div className="h-full bg-amber-400" style={{width:`${v}%`}} /></div></div>)}</div> : <p className="text-sm text-white/45">Market pair data unavailable.</p>}</div>
          <div className="rounded-2xl border border-white/10 bg-[#101010] p-5"><h3 className="font-semibold mb-3">Security audit</h3>{data.security.audit ? <><div className={`text-sm font-semibold mb-3 ${data.security.audit.passed ? 'text-emerald-300' : 'text-red-300'}`}>{data.security.audit.passed ? 'Checks passed' : 'One or more checks failed'} · RugCheck risk {data.security.audit.riskScore ?? 'n/a'}</div><div className="space-y-2">{data.security.audit.checks.map((c,i)=><div key={i} className="text-xs flex gap-2"><span className={c.passed ? 'text-emerald-300' : 'text-red-300'}>{c.passed ? '✓' : '✕'}</span><div><b>{label(c.name)}</b><p className="text-white/45">{c.detail}</p></div></div>)}</div></> : <p className="text-sm text-amber-200/70">{data.security.auditError || 'Audit unavailable.'}</p>}</div>
        </section>
        <section className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-white/10 bg-[#101010] p-5"><h3 className="font-semibold mb-3">Token authorities & holders</h3><p className="text-xs text-white/60">Mint authority: <span className="font-mono">{data.security.authorityDataAvailable ? (data.identity.mintAuthority ?? 'Renounced') : 'Unavailable'}</span></p><p className="text-xs text-white/60 mt-2">Freeze authority: <span className="font-mono">{data.security.authorityDataAvailable ? (data.identity.freezeAuthority ?? 'Renounced') : 'Unavailable'}</span></p><div className="mt-3 space-y-2">{data.security.holderConcentration.slice(0,10).map((h,i)=><div key={h.owner} className="flex justify-between gap-2 text-xs"><span className="font-mono text-white/50">{i+1}. {h.owner.slice(0,6)}…{h.owner.slice(-5)}</span><span>{h.pct.toFixed(2)}%</span></div>)}</div><p className="text-[11px] text-white/35 mt-2">Holder data source: {data.security.topHoldersSource || 'unavailable'} · Top holder in audit: {data.security.audit?.topHolderPct == null ? 'unknown' : `${data.security.audit.topHolderPct.toFixed(2)}%`}</p></div>
          <div className="rounded-2xl border border-white/10 bg-[#101010] p-5"><h3 className="font-semibold mb-3">Recent on-chain activity</h3><p className="text-xs text-white/35 mb-3">{data.activity.source}</p><div className="space-y-3 max-h-72 overflow-y-auto">{data.activity.transactions.slice(0,12).map(tx=><div key={tx.signature} className="border-b border-white/5 pb-2"><div className="flex justify-between gap-2 text-xs"><b>{tx.type}</b><span className={tx.failed ? 'text-red-300' : 'text-white/35'}>{tx.failed ? 'Failed' : tx.time ? new Date(tx.time).toLocaleString() : 'Time unavailable'}</span></div>{tx.description && <p className="text-xs text-white/45 mt-1">{tx.description}</p>}</div>)}{data.activity.transactions.length===0 && <p className="text-sm text-white/40">No recent activity returned.</p>}</div></div>
        </section>
        {data.security.warnings.length>0 && <p className="text-xs text-amber-200/70">Data warnings: {data.security.warnings.join(' · ')}</p>}
        <p className="text-xs text-white/35">{data.disclaimer} Sources: {data.security.sources.join(', ') || 'No external source confirmed'} · Updated {new Date(data.fetchedAt).toLocaleString()}.</p>
      </>}
    </div>
  </main>;
}
