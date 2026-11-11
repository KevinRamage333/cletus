'use client';
import { useCallback, useEffect, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const usd = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const short = (a?: string | null) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '—');
const dot = { ok: 'bg-emerald-400', warn: 'bg-amber-500', down: 'bg-red-500' } as const;

/** Dashboard header: status, version, wallet, balances, Resume/Pause, and the system status grid. All values from live APIs. */
export default function HeaderCard() {
  const [sess, setSess] = useState<any>(null);
  const [sys, setSys] = useState<any>(null);
  const [wal, setWal] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const get = (u: string) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [a, b, c] = await Promise.all([get('/api/protected/trade/session'), get('/api/system'), get('/api/protected/wallet/status')]);
    if (a) setSess(a); if (b) setSys(b); if (c) setWal(c);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);
  const act = async (path: string) => { setBusy(true); await fetch(path, { method: 'POST' }).catch(() => null); await load(); setBusy(false); };
  const running = sess && sess.running && !sess.paused;
  const status = !sess ? '…' : sys?.killSwitch ? 'Kill switch' : !sess.running ? 'Stopped' : sess.paused ? 'Paused' : !sess.withinHours ? 'Outside hours' : 'Running';
  return (
    <section className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-[#1a1508] to-[#0d0d0d] p-4 space-y-4">
      <div className="flex items-center gap-3">
        <img src="/cletus-avatar.png" alt="Cletus" width={48} height={48} className="rounded-full ring-2 ring-emerald-500/60" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-lg gold-text">Cletus</span>
            <span className="text-[10px] font-mono text-white/40">v{sys?.version ?? '…'}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${running ? 'border-emerald-500/50 text-emerald-400' : 'border-amber-500/50 text-amber-400'}`}>● {status}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${sess?.mode === 'live' ? 'border-red-500/60 text-red-400' : 'border-white/20 text-white/60'}`}>{sess?.mode === 'live' ? 'LIVE' : 'PAPER'}</span>
          </div>
          <div className="text-xs text-white/50 font-mono mt-0.5" title={wal?.address ?? ''}>{wal?.address ? `${short(wal.address)} · ${wal?.balancesKnown ? `${Number(wal.solBalance).toFixed(4)} SOL · ${Number(wal.usdcBalance).toFixed(2)} USDC` : 'balance unavailable'}` : 'Paper mode'}</div>
          {sess?.pauseReason && !running && <div className="text-[11px] text-amber-400/80 mt-0.5 truncate">{sess.pauseReason}</div>}
        </div>
        {sess && (!sess.running || sess.paused ? (
          <button disabled={busy || sys?.killSwitch} onClick={() => act(sess.running ? '/api/protected/trade/resume' : '/api/protected/trade/start')} className="shrink-0 px-4 py-2 rounded-full text-xs font-semibold bg-gradient-to-r from-[#D4AF37] to-[#F59E0B] text-black disabled:opacity-40">▶ Resume</button>
        ) : (
          <button disabled={busy} onClick={() => act('/api/protected/trade/pause')} className="shrink-0 px-4 py-2 rounded-full text-xs font-semibold border border-emerald-500/50 text-emerald-400 disabled:opacity-40">❚❚ Pause</button>
        ))}
      </div>
      <div className="text-[11px] text-white/35">{wal?.address ? 'On-chain balance of the wallet you connected (you stay in control).' : 'Paper mode — no wallet connected.'} Paper trading uses a simulated balance ({usd(sess?.capital)} equity · {usd(sess?.available)} cash).</div>
      <div className="grid grid-cols-2 gap-2">
        {sys ? (['rpc', 'ai', 'signals', 'risk'] as const).map((k) => (
          <div key={k} className="rounded-xl border border-white/10 bg-black/40 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold"><span className={`w-2 h-2 rounded-full ${dot[sys.grid[k].level as 'ok' | 'warn' | 'down']}`} />{sys.grid[k].label}</div>
            <div className="text-[10px] text-white/40 mt-0.5 leading-snug">{sys.grid[k].detail}</div>
          </div>
        )) : <div className="text-xs text-white/40">Loading system status…</div>}
      </div>
    </section>
  );
}
