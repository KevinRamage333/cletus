'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import TokenChart from '@/components/TokenChart';
import PaperPlan from '@/components/PaperPlan';
type Token={mint:string;pool:string;symbol:string;name:string;dex:string;priceUsd:number;marketCapUsd:number;liquidityUsd:number|null;volume24hUsd:number;change1hPct:number;change24hPct:number|null;score:number;rejected:string|null;actionable?:boolean;openPaperPosition:boolean;paperPnlUsd:number|null;paperPnlPct:number|null};
type Feed={tokens:Token[];snapshotFresh?:boolean;snapshotAgeSeconds?:number|null;scanAt:string|null;candidateScanAt:string|null;scanCount:number;scanning:boolean;summary:string;cachedCandidates?:boolean;engine:{killSwitch:boolean;stateAvailable:boolean}};
type Intel={identity:{mintAuthority:string|null;freezeAuthority:string|null};security:{audit:{passed:boolean;checks:Array<{name:string;passed:boolean;detail:string}>}|null;auditError:string|null;holderConcentration:Array<{owner:string;pct:number}>;sources:string[]}};
const money=(n:number|null|undefined)=>n==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:n<1?7:2}).format(n);
const short=(n:number|null|undefined)=>n==null?'—':n>=1e9?'$'+(n/1e9).toFixed(2)+'B':n>=1e6?'$'+(n/1e6).toFixed(2)+'M':n>=1e3?'$'+(n/1e3).toFixed(1)+'K':money(n);
const change=(n:number|null)=>n==null?'—':(n>=0?'+':'')+n.toFixed(2)+'%';
export default function DiscoverPage(){
 const [feed,setFeed]=useState<Feed|null>(null),[selected,setSelected]=useState<Token|null>(null),[intel,setIntel]=useState<Intel|null>(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[sort,setSort]=useState('score'),[filter,setFilter]=useState('all');
 const [feedError, setFeedError] = useState('');
 const [loadingFeed, setLoadingFeed] = useState(true);
 const [now, setNow] = useState(0);
 const feedRequest = useRef<AbortController | null>(null);

 const load = useCallback(async () => {
   setNow(Date.now());
   if (feedRequest.current) return;
   const controller = new AbortController();
   feedRequest.current = controller;
   setLoadingFeed(true);
   const timeout = window.setTimeout(() => controller.abort(), 8_000);
   try {
     const response = await fetch('/api/tokens/discover', { cache: 'no-store', signal: controller.signal });
     if (!response.ok) throw new Error('Discovery request failed');
     const next: Feed = await response.json();
     if (!Array.isArray(next?.tokens) || !next.engine) throw new Error('Invalid discovery feed');
     if (feedRequest.current === controller) {
       setFeed(previous => !Number.isFinite(Date.parse(next.candidateScanAt ?? '')) && previous?.candidateScanAt
         ? { ...next, candidateScanAt: previous.candidateScanAt, tokens: previous.tokens, cachedCandidates: true }
         : next);
       setFeedError('');
     }
   } catch {
     if (feedRequest.current === controller) setFeedError('Discovery could not refresh.');
   } finally {
     window.clearTimeout(timeout);
     if (feedRequest.current === controller) {
       feedRequest.current = null;
       setLoadingFeed(false);
     }
   }
 }, []);

 useEffect(() => {
   void load();
   const timer = window.setInterval(() => void load(), 5_000);
   return () => {
     window.clearInterval(timer);
     const active = feedRequest.current;
     feedRequest.current = null;
     active?.abort();
   };
 }, [load]);

 const candidateAt = feed?.candidateScanAt ? Date.parse(feed.candidateScanAt) : NaN;
 const snapshotAvailable = Number.isFinite(candidateAt);
 const candidateStale = snapshotAvailable && (now - candidateAt > 120_000 || feed?.snapshotFresh === false);
 const signalsActionable = snapshotAvailable && !candidateStale && feed?.snapshotFresh === true && feed?.engine.stateAvailable === true && feed?.engine.killSwitch === false && !feedError && !feed?.cachedCandidates;
 const feedStatus = feedError ? (snapshotAvailable ? 'Refresh failed' : 'Unavailable')
   : candidateStale ? 'Snapshot stale'
   : feed?.cachedCandidates ? 'Cached snapshot'
   : snapshotAvailable ? 'Snapshot available'
   : loadingFeed ? 'Loading feed' : 'Waiting for snapshot';
 useEffect(()=>{if(!selected)return;let live=true;setIntel(null);setError('');fetch('/api/tokens/intelligence?mint='+encodeURIComponent(selected.mint),{cache:'no-store'}).then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error||'Intelligence unavailable');if(live)setIntel(j);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;}},[selected?.mint]);
 const rows=useMemo(()=>[...(feed?.tokens??[])].filter(t=>(filter==='all'||(filter==='qualified'?!t.rejected:t.openPaperPosition))&&(!query||[t.symbol,t.name,t.mint].some(x=>x.toLowerCase().includes(query.toLowerCase())))).sort((a,b)=>sort==='volume'?b.volume24hUsd-a.volume24hUsd:sort==='momentum'?b.change1hPct-a.change1hPct:b.score-a.score),[feed,filter,query,sort]);
 return <main className="min-h-screen bg-black text-white p-3 sm:p-5"><div className="max-w-6xl mx-auto space-y-4">
 <header className="flex justify-between items-center"><div><Link href="/app" className="text-xs text-amber-300">← Dashboard</Link><h1 className="text-2xl font-black mt-1">CLETUS <span className="text-amber-300">DISCOVERY</span></h1><p className="text-xs text-white/40">Solana token scanner · paper trading</p></div><div className="text-right text-xs">{feedStatus}<div className="text-white/35">{snapshotAvailable ? new Date(candidateAt).toLocaleTimeString() : 'No candidate timestamp'}</div></div></header>
 <div className="grid grid-cols-3 gap-2">{[['Candidates',snapshotAvailable ? feed?.tokens.length ?? 0 : '—'],['Scan cycles',feed?.scanCount??'—'],['Engine',feed?.engine.stateAvailable ? (feed.engine.killSwitch ? 'PAUSED' : 'PAPER') : '—']].map(([k,v])=><div key={String(k)} className="bg-white/[.04] border border-white/10 rounded-xl p-3"><div className="text-[10px] text-white/40">{k}</div><b>{v}</b></div>)}</div>
 {feedError && <p role="status" className="text-sm text-amber-300">{feedError}{snapshotAvailable ? ' Showing the last available snapshot.' : ''}</p>}
 {candidateStale && <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">The candidate snapshot is over 2 minutes old. Scores are historical, not current trade signals. Refresh or wait for a new scan.</p>}
 {!signalsActionable && snapshotAvailable && !candidateStale && <p role="status" className="rounded-lg border border-amber-500/30 p-3 text-xs text-amber-300">Signals are not actionable: scanner freshness, engine state or latest feed has not been confirmed. Historical coin inspection remains available.</p>}
 {feed?.scanAt && !snapshotAvailable && !feedError && <p className="text-sm text-amber-300">The worker recorded a scan, but its candidate snapshot is unavailable on this server.</p>}
 {selected?<section className="space-y-3"><button onClick={()=>{setSelected(null);setIntel(null)}} className="text-amber-300 text-sm">← Back to tokens</button><div className="bg-[#101010] border border-white/10 rounded-xl p-4 flex justify-between gap-3"><div><b className="text-xl">{selected.name} <span className="text-amber-300">${selected.symbol}</span></b><p className="text-[10px] text-white/40 break-all">{selected.mint}</p></div><div className="text-right"><b className="text-xl font-mono">{money(selected.priceUsd)}</b><p className="text-[10px] text-white/40">Price when selected</p><p className="text-xs text-amber-300">Cletus {selected.score}/100</p></div></div>
 <TokenChart key={selected.mint} address={selected.mint} pool={selected.pool} height={430}/>
 {signalsActionable && selected.actionable ? <PaperPlan key={selected.mint} symbol={selected.symbol} referencePrice={selected.priceUsd}/> : <p className="rounded-lg border border-amber-500/30 p-3 text-sm text-amber-300">Paper plan hidden while the scanner or engine state is stale, unavailable or paused. You can still inspect this token.</p>}
 <div className="grid md:grid-cols-2 gap-3"><div className="bg-[#101010] border border-white/10 rounded-xl p-4"><h2 className="font-bold mb-2">Cletus trade read</h2><p className="text-sm text-white/60">1h {change(selected.change1hPct)} · 24h {change(selected.change24hPct)} · liquidity {short(selected.liquidityUsd)} · volume {short(selected.volume24hUsd)}</p><p className="text-xs text-white/40 mt-3">Score is a heuristic rank, not a probability of profit. Trade plans and orders must pass the existing risk and paper-fill engine.</p>{selected.openPaperPosition&&<p className="mt-2 text-sm">Paper P&amp;L: <b className={(selected.paperPnlUsd??0)>=0?'text-emerald-400':'text-red-400'}>{money(selected.paperPnlUsd)} ({change(selected.paperPnlPct)})</b></p>}</div>
 <div className="bg-[#101010] border border-white/10 rounded-xl p-4 space-y-2"><h2 className="font-bold">Developer &amp; security</h2>{!intel&&!error&&<p className="text-xs text-white/40">Inspecting authorities, holders and sell-route risk…</p>}{error&&<p className="text-xs text-red-300">{error}</p>}{intel&&<><p className="text-xs">Mint authority: <b>{intel.identity.mintAuthority?'Enabled':'Revoked / unavailable'}</b></p><p className="text-xs">Freeze authority: <b>{intel.identity.freezeAuthority?'Enabled':'Revoked / unavailable'}</b></p><p className="text-xs">Pre-trade audit: <b>{intel.security.audit?(intel.security.audit.passed?'Passed':'Failed'):(intel.security.auditError||'Unavailable')}</b></p><p className="text-xs">Top holders: {intel.security.holderConcentration.length}</p>{intel.security.audit?.checks.map((c,i)=><p key={i} className="text-[11px] text-white/55">{c.passed?'✓':'⚠'} {c.name}: {c.detail}</p>)}<p className="text-[10px] text-white/30">{intel.security.sources.join(', ')}</p></>}</div></div></section>
 :<><div className="flex flex-wrap gap-2"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search ticker, name or mint" className="flex-1 min-w-[170px] bg-[#101010] border border-white/10 rounded-lg px-3 py-2 text-sm"/><select value={filter} onChange={e=>setFilter(e.target.value)} className="bg-[#101010] border border-white/10 rounded-lg px-3 py-2 text-sm"><option value="all">All scanned</option><option value="qualified">Qualified</option><option value="held">Open paper trades</option></select><select value={sort} onChange={e=>setSort(e.target.value)} className="bg-[#101010] border border-white/10 rounded-lg px-3 py-2 text-sm"><option value="score">Cletus score</option><option value="volume">24h volume</option><option value="momentum">1h momentum</option></select><button onClick={()=>void load()} aria-label="Refresh discovery feed" disabled={loadingFeed} className="bg-amber-300 text-black rounded-lg px-4 text-sm font-bold disabled:opacity-50">↻</button></div>
 <section aria-label="Scanned tokens" className="overflow-hidden rounded-2xl border border-white/10 bg-[#080808]">
   <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3"><h2 className="font-semibold">Coins <span className="text-[#D4AF37]">· Cletus graded</span></h2><span className="text-xs text-white/40">{rows.length} scanned</span></div>
   {rows.length ? rows.map(t => (
     <article key={`${t.mint}:${t.pool}`} className="border-b border-white/10 last:border-b-0 hover:bg-white/[.035]">
       <div className="flex items-center gap-3 p-3 sm:p-4">
         <div aria-hidden="true" className={`flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-2xl border-2 bg-[#141414] text-lg font-black ${t.rejected ? 'border-rose-500/60 text-rose-300' : 'border-emerald-400/70 text-[#E5C76B]'}`}>
           {t.symbol.slice(0, 3).toUpperCase()}
         </div>
         <div className="min-w-0 flex-1 space-y-2">
           <div className="flex items-center justify-between gap-2">
             <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-bold sm:text-base">{t.name || t.symbol}</h3><span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${t.rejected ? 'border-rose-400/60 text-rose-300' : t.score >= 75 ? 'border-emerald-400/60 text-emerald-300' : 'border-[#D4AF37]/60 text-[#E5C76B]'}`}>{!signalsActionable || !t.actionable ? 'NOT LIVE' : t.rejected ? 'FILTERED' : t.score >= 75 ? 'HIGH SCORE' : 'SCANNED'}</span></div><p className="truncate text-xs text-white/45">{t.symbol} · {t.dex}</p></div>
             <div className="shrink-0 text-right text-[11px] sm:text-xs"><div><span className="text-white/45">V </span><b>{short(t.volume24hUsd)}</b> <span className="text-white/45">MC </span><b className="text-sky-400">{short(t.marketCapUsd)}</b></div><div className="mt-1 text-white/60">Liq <span className="text-[#E5C76B]">{short(t.liquidityUsd)}</span></div></div>
           </div>
           <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold"><span className="text-[#E5C76B]">Cletus {t.score}/100</span><span className={t.change1hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>1h {change(t.change1hPct)}</span><span className={t.change24hPct == null ? 'text-white/40' : t.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>24h {change(t.change24hPct)}</span><span className="text-white/50">{money(t.priceUsd)}</span></div>
           <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${t.rejected ? 'bg-rose-400' : 'bg-[#D4AF37]'}`} style={{width: `${Math.max(0,Math.min(100,t.score))}%`}} /></div><span className="text-[10px] text-white/45">Score</span></div>
           {t.openPaperPosition && <div className={`text-xs font-semibold ${(t.paperPnlUsd ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>Open paper P&amp;L {money(t.paperPnlUsd)} · {change(t.paperPnlPct)}</div>}
           <div className="flex flex-wrap items-center gap-3 text-xs"><Link href={`/app/chart?${new URLSearchParams({address:t.mint,...(t.pool?{pool:t.pool}:{})})}`} className="font-semibold text-[#E5C76B] hover:underline">Chart ↗</Link><button type="button" onClick={() => setSelected(t)} className="text-white/70 hover:text-white">Audit &amp; paper trade →</button></div>
         </div>
       </div>
     </article>
   )) : <p className="p-8 text-center text-sm text-white/50">{!feed && loadingFeed ? 'Loading the discovery feed…' : !snapshotAvailable ? 'Waiting for a candidate snapshot.' : feed?.tokens.length ? 'No tokens match these filters.' : 'This scan returned no candidates.'}</p>}

 </section></>}

 <p className="text-[10px] text-white/30">{feed?.summary} · refreshes every 5 seconds. Market movement is not P&amp;L; only open paper positions show simulated P&amp;L.</p></div></main>;
}