'use client';
/** Dev Wallet Inspector: paste any Solana wallet or token address → live SOL balance, holdings, recent transactions (Helius). Route: /app/dev-wallet */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

/* eslint-disable @typescript-eslint/no-explicit-any */
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const usd = (n?: number | null) => (n === null || n === undefined ? '—' : `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 })}`);
const amt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 });

export default function DevWalletPage() {
  const params = useSearchParams();
  const [q, setQ] = useState('');
  useEffect(() => { const address = params.get('address'); if (address && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) setQ(address); }, [params]);
  const [d, setD] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const inspect = async () => {
    const a = q.trim(); if (!a) return;
    setBusy(true); setErr(null); setAudit(null);
    try {
      const r = await fetch(`/api/inspect?address=${encodeURIComponent(a)}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'lookup failed');
      setD(j);
    } catch (e) { setErr((e as Error).message); setD(null); } finally { setBusy(false); }
  };
  const runAudit = async () => {
    if (!d) return;
    setBusy(true);
    const r = await fetch('/api/community/dev-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: d.address, announce: false }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setAudit(j); else setErr(j.error ?? 'audit failed');
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="border-b border-white/10 px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-2.5">
          <img src="/cletus-logo.png" alt="Cletus" width={36} height={36} className="rounded-full" />
          <div><div className="font-bold text-lg leading-none gold-text">Cletus</div><div className="text-xs text-white/50 mt-0.5">Dev Wallet Inspector</div></div>
        </div>
      </header>
      <main className="flex-1 px-4 sm:px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <p className="text-sm text-white/55">Paste any Solana wallet or token mint. Cletus reads it live from the chain through Helius (balance, token holdings via DAS, recent transactions). Read-only: nothing is signed or sent.</p>
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && inspect()} placeholder="Wallet or token address" className="flex-1 font-mono text-sm px-3 py-2.5 rounded-xl bg-[#121212] border border-white/10 focus:outline-none focus:border-amber-400/50" />
            <button onClick={inspect} disabled={busy} className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-amber-400 text-black disabled:opacity-50">{busy ? '…' : 'Inspect'}</button>
          </div>
          {err && <p className="text-xs text-red-400">{err}</p>}
          {d && (
            <>
              <section className="rounded-2xl border border-amber-400/20 bg-[#121212] p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-400/40 text-amber-300">{d.kind}</span>
                  <a href={`https://solscan.io/${d.kind === 'token' ? 'token' : 'account'}/${d.address}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-white/70 hover:text-amber-300 break-all">{d.address}</a>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="rounded-xl bg-black/40 border border-white/10 p-3"><div className="text-[10px] text-white/40">SOL balance</div><div className="font-mono font-bold">{amt(d.solBalance ?? 0)}</div></div>
                  {d.kind !== 'token' && <div className="rounded-xl bg-black/40 border border-white/10 p-3"><div className="text-[10px] text-white/40">Tokens held</div><div className="font-mono font-bold">{d.holdings.length}</div></div>}
                  {d.kind !== 'token' && <div className="rounded-xl bg-black/40 border border-white/10 p-3"><div className="text-[10px] text-white/40">Priced holdings</div><div className="font-mono font-bold">{usd(d.holdingsTotalUsd)}</div></div>}
                  {d.token && <div className="rounded-xl bg-black/40 border border-white/10 p-3"><div className="text-[10px] text-white/40">Price</div><div className="font-mono font-bold">{usd(d.token.priceUsd)}</div></div>}
                  {d.token && <div className="rounded-xl bg-black/40 border border-white/10 p-3"><div className="text-[10px] text-white/40">Market cap</div><div className="font-mono font-bold">{usd(d.token.marketCap)}</div></div>}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={runAudit} disabled={busy} className="px-3 py-1.5 rounded-full text-xs border border-amber-400/50 text-amber-300">Run risk audit</button>
                  {d.kind === 'token' && <Link href={`/app/chart?address=${d.address}`} className="px-3 py-1.5 rounded-full text-xs border border-white/15 text-white/70">📈 Chart</Link>}
                </div>
                <div className="text-[10px] text-white/30">Sources: {d.source.join(', ')} · fetched {new Date(d.fetchedAt).toLocaleTimeString()}{d.errors?.length ? ` · partial: ${d.errors.join('; ')}` : ''}</div>
              </section>

              {audit && (
                <section className="rounded-2xl border border-white/10 bg-[#121212] p-4 space-y-2">
                  <div className="text-sm font-semibold">Audit: <span className={audit.status === 'high_risk' ? 'text-red-400' : audit.status === 'watch' ? 'text-amber-400' : 'text-amber-300'}>{audit.status.replace('_', ' ')}</span></div>
                  <p className="text-xs text-white/50">{audit.summary}</p>
                  <ul className="space-y-1">{audit.findings.map((f: any) => <li key={f.label} className="text-xs"><span className={f.severity === 'high' ? 'text-red-400' : f.severity === 'watch' ? 'text-amber-400' : 'text-white/50'}>●</span> <strong className="text-white/80">{f.label}:</strong> <span className="text-white/60">{f.detail}</span></li>)}</ul>
                </section>
              )}

              {d.token && (
                <section className="rounded-2xl border border-white/10 bg-[#121212] p-4">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">Token</h2>
                  <div className="text-xs text-white/70 space-y-1">
                    <div>{d.token.symbol ?? '—'} {d.token.name ? `· ${d.token.name}` : ''} · supply {amt(d.token.supply)} · {d.token.decimals} decimals</div>
                    <div>Mint authority: <span className={d.token.mintAuthority ? 'text-red-400' : 'text-amber-300'}>{d.token.mintAuthority ? short(d.token.mintAuthority) : 'revoked'}</span> · Freeze authority: <span className={d.token.freezeAuthority ? 'text-red-400' : 'text-amber-300'}>{d.token.freezeAuthority ? short(d.token.freezeAuthority) : 'revoked'}</span></div>
                  </div>
                  <h3 className="text-[11px] text-white/40 mt-3 mb-1">Largest holders (owner wallets; may include pools/lockers)</h3>
                  <div className="space-y-1">{d.token.topHolders.map((h: any, i: number) => (
                    <div key={h.owner + i} className="flex items-center gap-2 text-xs"><span className="w-5 text-white/30">{i + 1}</span><button onClick={() => { setQ(h.owner); }} className="font-mono text-white/70 hover:text-amber-300">{short(h.owner)}</button><div className="flex-1 h-1.5 rounded bg-white/5"><div className="h-full rounded bg-amber-400/70" style={{ width: `${Math.min(100, h.pct)}%` }} /></div><span className="font-mono w-14 text-right">{h.pct.toFixed(2)}%</span></div>
                  ))}</div>
                </section>
              )}

              {d.holdings.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-[#121212] p-4">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">Token holdings</h2>
                  <div className="divide-y divide-white/5">{d.holdings.slice(0, 50).map((h: any) => (
                    <div key={h.mint} className="flex items-center gap-2 py-1.5 text-xs"><span className="font-semibold w-20 truncate">{h.symbol ?? short(h.mint)}</span><span className="text-white/40 truncate flex-1">{h.name ?? h.mint}</span><span className="font-mono">{amt(h.amount)}</span><span className="font-mono w-24 text-right text-amber-300/80">{usd(h.valueUsd)}</span></div>
                  ))}</div>
                </section>
              )}

              <section className="rounded-2xl border border-white/10 bg-[#121212] p-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">Recent transactions</h2>
                {d.transactions.length === 0 ? <p className="text-xs text-white/40">None found.</p> : (
                  <div className="divide-y divide-white/5">{d.transactions.map((t: any) => (
                    <div key={t.signature} className="py-1.5 text-xs flex gap-2 items-start">
                      <span className={`shrink-0 px-1.5 rounded text-[10px] ${t.failed ? 'bg-red-500/15 text-red-400' : 'bg-amber-400/10 text-amber-300'}`}>{t.type}</span>
                      <span className="flex-1 text-white/60 break-words">{t.description || '—'}</span>
                      <a href={`https://solscan.io/tx/${t.signature}`} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-white/40 hover:text-amber-300">{t.time ? new Date(t.time).toLocaleString() : short(t.signature)}</a>
                    </div>
                  ))}</div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
