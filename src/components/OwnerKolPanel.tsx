'use client';
/** Owner desk: KOL / pump.fun add-on — wallet balance, what it is scanning, open KOL position, KOL trade history with P&L. */
import type { KolDesk } from '@/lib/owner-kol';

const usd = (n: number | null | undefined, d = 2) => (n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(d)}`);
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const tone = (n: number) => (n > 0 ? 'text-emerald-300' : n < 0 ? 'text-red-400' : 'text-white/60');
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const t = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export default function OwnerKolPanel({ kol, scanOnly = false }: { kol: KolDesk | null | undefined; scanOnly?: boolean }) {
  if (!kol) return null;
  const rows = kol.round.rows;
  return (
    <section className="card p-4 space-y-4">
      {!scanOnly && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">KOL / pump.fun mode</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${kol.enabled ? 'border-emerald-400/50 text-emerald-300' : 'border-white/20 text-white/50'}`}>{kol.enabled ? 'LIVE' : 'OFF'}</span>
            <span className="text-[11px] text-white/45">source: {kol.source === 'hype' ? 'free hype (DexScreener boosts, pump.fun, GeckoTerminal, Phantom)' : kol.source}</span>
            <a className="ml-auto text-xs font-mono underline text-white/60" href={`https://solscan.io/account/${kol.wallet}`} target="_blank" rel="noreferrer">{short(kol.wallet)}</a>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><div className="text-[11px] text-white/45">Wallet</div><b>{kol.sol == null ? '—' : `${kol.sol.toFixed(4)} SOL`}</b> <span className="text-white/50">{usd(kol.usd)}</span></div>
            <div><div className="text-[11px] text-white/45">Open</div><b>{kol.open.length}</b></div>
            <div><div className="text-[11px] text-white/45">Closed trades</div><b>{kol.totals.trades}</b> <span className="text-white/50">{kol.totals.trades ? `${Math.round((kol.totals.wins / kol.totals.trades) * 100)}% wins` : ''}</span></div>
            <div><div className="text-[11px] text-white/45">Realized P&amp;L</div><b className={tone(kol.totals.pnlUsd)}>{usd(kol.totals.pnlUsd)}</b></div>
          </div>

          {kol.open.map((p) => (
            <div key={p.id} className="rounded border border-emerald-400/30 p-3 text-sm flex flex-wrap gap-x-4 gap-y-1">
              <b>{p.symbol}</b><span className="font-mono text-[11px] text-white/50">{short(p.mint)}</span>
              <span>size {usd(p.sizeUsd)}</span><span>value {usd(p.valueUsd)}</span>
              <span className={tone(p.pnlUsd)}>{usd(p.pnlUsd)} ({pct(p.pnlPct)})</span>
              <span className="text-white/50">opened {t(p.openedAt)} · exits +15% / -7% / 60m stale</span>
            </div>
          ))}
        </>
      )}

      <div>
        {scanOnly && (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${kol.enabled ? 'border-emerald-400/50 text-emerald-300' : 'border-white/20 text-white/50'}`}>{kol.enabled ? 'LIVE' : 'OFF'}</span>
            <span className="text-[11px] text-white/45">source: {kol.source === 'hype' ? 'free hype (DexScreener boosts, pump.fun, GeckoTerminal, Phantom)' : kol.source} · exits +15% / −7% / 60m stale</span>
          </div>
        )}
        <div className="text-sm font-semibold mb-1">Scanning now <span className="text-[11px] font-normal text-white/45">{t(kol.round.at)} · {kol.round.summary}</span></div>
        {rows.length ? (
          <div className="overflow-x-auto"><table className="w-full text-[11px]">
            <thead className="text-white/45 text-left"><tr><th className="pr-2">Token</th><th className="pr-2">Mcap</th><th className="pr-2">Via</th><th className="pr-2">Decision</th><th>Why</th></tr></thead>
            <tbody>{rows.slice(0, 20).map((r) => (
              <tr key={r.mint} className="border-t border-white/5 align-top">
                <td className="pr-2 py-0.5"><a className="underline" href={`https://dexscreener.com/solana/${r.mint}`} target="_blank" rel="noreferrer">{r.symbol}</a></td>
                <td className="pr-2">{r.mcapUsd != null ? `$${Math.round(r.mcapUsd / 1000)}k` : '—'}</td>
                <td className="pr-2 text-white/50">{r.via.replace(/^hype:/, '')}</td>
                <td className={`pr-2 ${r.decision.startsWith('picked') ? 'text-emerald-300' : 'text-white/70'}`}>{r.decision.replace(/^kol: /, '')}</td>
                <td className="text-white/45">{r.reason.slice(0, 140)}</td>
              </tr>))}
            </tbody></table></div>
        ) : <div className="text-[11px] text-white/45">No KOL candidates in the last round.</div>}
      </div>

      {!scanOnly && <div>
        <div className="text-sm font-semibold mb-1">KOL trade history</div>
        {kol.history.length ? (
          <ul className="text-[11px] space-y-0.5">{kol.history.slice(0, 25).map((h) => (
            <li key={h.id} className="text-white/65">{t(h.closedAt)} · <b>{h.symbol}</b> {usd(h.sizeUsd)} → <span className={tone(h.pnlUsd)}>{usd(h.pnlUsd)} ({pct(h.pnlPct)})</span>{h.exitReason ? ` · ${h.exitReason}` : ''}{h.exitTxUrl && <> · <a className="underline" href={h.exitTxUrl} target="_blank" rel="noreferrer">tx</a></>}</li>
          ))}</ul>
        ) : <div className="text-[11px] text-white/45">No KOL trades yet.</div>}
      </div>}
    </section>
  );
}
