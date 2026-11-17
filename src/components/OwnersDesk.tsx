'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  OWNERS_DESK_TITLE,
  PAPER_STARTING_CAPITAL_USD,
  docName,
  filterDocsByContent,
  searchDocs,
  type OwnersDeskPayload,
  type SyncedDoc,
} from '@/lib/owners-desk';

const usd = (n: number | null | undefined, d = 2) =>
  n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const tone = (n: number | null | undefined) => (n == null ? 'text-white/70' : n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-white/70');
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);

export default function OwnersDesk({ onAuthLost }: { onAuthLost?: () => void }) {
  const [data, setData] = useState<OwnersDeskPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [docBody, setDocBody] = useState<Record<string, string>>({});
  const [docErr, setDocErr] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/owner/desk', { cache: 'no-store', credentials: 'include' });
      if (r.status === 401 || r.status === 403) { onAuthLost?.(); return; }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'failed');
      setData(j); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, [onAuthLost]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected || docBody[selected]) return;
    let cancelled = false;
    setDocErr(null);
    (async () => {
      try {
        const r = await fetch(`/api/owner/desk/doc?path=${encodeURIComponent(selected)}`, { cache: 'no-store', credentials: 'include' });
        if (r.status === 401 || r.status === 403) { onAuthLost?.(); return; }
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'failed');
        if (!cancelled) setDocBody((prev) => ({ ...prev, [selected]: String(j.content ?? '') }));
      } catch (e) {
        if (!cancelled) setDocErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [selected, docBody, onAuthLost]);

  const docs = useMemo(() => {
    if (!data) return [] as SyncedDoc[];
    if (!query.trim()) return data.docs;
    const seen = new Set<string>();
    const out: SyncedDoc[] = [];
    for (const d of [...searchDocs(data.docs, query), ...filterDocsByContent(data.docs, docBody, query)]) {
      if (seen.has(d.path)) continue;
      seen.add(d.path);
      out.push(d);
    }
    return out;
  }, [data, query, docBody]);

  if (!data) {
    return (
      <section className="rounded-2xl border border-amber-500/30 bg-[#0b0a07] p-4 sm:p-5" data-testid="owners-desk">
        <h2 className="gold-text font-bold text-xl">{OWNERS_DESK_TITLE}</h2>
        <p className="text-sm text-white/50 mt-2">{err ? <span className="err">{err}</span> : 'Loading The Owner’s Desk…'}</p>
      </section>
    );
  }

  const paper = data.paper;
  const latest = data.latestProgress;

  return (
    <section className="space-y-6" data-testid="owners-desk">
      <div>
        <h2 className="gold-text font-bold text-2xl leading-none">{OWNERS_DESK_TITLE}</h2>
        <p className="text-xs text-white/45 mt-1">Synced from the box into Neon. Real data only. Paper trading is a simulation.</p>
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-[#0b0a07] p-4 sm:p-5" data-testid="owners-desk-progress">
        <div className="text-[11px] uppercase tracking-wider text-amber-300/80">Latest build progress</div>
        {latest ? (
          <div className="mt-2 space-y-2">
            <div className="text-lg font-semibold text-[#f3dc95]">{latest.workstream}</div>
            <div className="text-xs font-mono text-white/50">{new Date(latest.savedAt).toLocaleString()}{latest.gitRef ? ` · ${latest.gitRef}` : ''}</div>
            <pre className="whitespace-pre-wrap text-sm text-white/80 font-sans">{latest.summary}</pre>
          </div>
        ) : (
          <p className="text-sm text-white/50 mt-2" data-testid="owners-desk-progress-empty">No build progress has been saved yet.</p>
        )}
        {data.progress.length > 1 && (
          <ol className="mt-4 space-y-1 text-xs text-white/45 font-mono">
            {data.progress.slice(1).map((row) => (
              <li key={row.id}>{new Date(row.savedAt).toLocaleString()} · {row.workstream}</li>
            ))}
          </ol>
        )}
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-[#0b0a07] p-4 sm:p-5" data-testid="owners-desk-paper">
        <div className="text-[11px] uppercase tracking-wider text-amber-300/80">Paper trading · ${PAPER_STARTING_CAPITAL_USD} start</div>
        {paper.empty ? (
          <p className="text-sm text-white/50 mt-2" data-testid="owners-desk-paper-empty">{paper.emptyMessage}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3 mt-2">
              <div>
                <div className="text-4xl font-extrabold font-mono leading-tight" data-testid="owners-desk-equity">{usd(paper.equityUsd)}</div>
                <div className={`text-sm font-mono mt-1 ${tone(paper.pnlVsStartUsd)}`} data-testid="owners-desk-pnl">
                  {usd(paper.pnlVsStartUsd)} vs ${PAPER_STARTING_CAPITAL_USD} start ({pct(paper.pnlVsStartPct)})
                </div>
              </div>
              <div className="text-xs text-white/55 space-y-0.5 font-mono text-right">
                <div>Cash {usd(paper.cashUsd)}</div>
                <div>Win rate <span data-testid="owners-desk-winrate">{paper.winRatePct == null ? '—' : `${paper.winRatePct.toFixed(1)}%`}</span></div>
                <div>{paper.openCount} open · {paper.closedCount} closed</div>
                <div className="text-white/35">Source {paper.source.replace('_', ' ')}</div>
              </div>
            </div>
            {paper.trades.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs font-mono" data-testid="owners-desk-trades">
                  <thead className="text-amber-300/80 uppercase tracking-wider">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Token</th>
                      <th className="py-1 pr-3 font-medium">Network</th>
                      <th className="py-1 pr-3 font-medium">Status</th>
                      <th className="py-1 pr-3 font-medium text-right">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paper.trades.slice(0, 25).map((t, i) => (
                      <tr key={`${t.token}-${t.network}-${t.status}-${i}`} className="border-t border-white/10">
                        <td className="py-1.5 pr-3 text-white/90">{t.token}</td>
                        <td className="py-1.5 pr-3 text-white/55">{t.network}</td>
                        <td className="py-1.5 pr-3 text-white/55">{t.status}</td>
                        <td className={`py-1.5 text-right ${tone(t.pnlUsd)}`}>{usd(t.pnlUsd)}{t.pnlPct != null ? ` (${pct(t.pnlPct)})` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-white/50 mt-3">No individual trades to list yet.</p>
            )}
          </>
        )}
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-[#0b0a07] p-4 sm:p-5" data-testid="owners-desk-docs">
        <div className="text-[11px] uppercase tracking-wider text-amber-300/80">Synced docs</div>
        <label className="block mt-2">
          <span className="sr-only">Search docs</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs…"
            data-testid="owners-desk-doc-search"
            className="w-full rounded-lg border border-amber-500/30 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400"
          />
        </label>
        {data.docs.length === 0 ? (
          <p className="text-sm text-white/50 mt-3" data-testid="owners-desk-docs-empty">No documents have been synced yet.</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-white/50 mt-3">No documents match that search.</p>
        ) : (
          <ul className="mt-3 space-y-1 max-h-56 overflow-y-auto" data-testid="owners-desk-doc-list">
            {docs.map((d) => (
              <li key={d.path}>
                <button
                  type="button"
                  onClick={() => setSelected(d.path)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-sm font-mono ${selected === d.path ? 'bg-amber-500/15 text-[#f3dc95]' : 'text-white/70 hover:bg-white/5'}`}
                >
                  <span className="text-amber-300/70">{d.workstream ?? 'file'}</span> · {docName(d.path)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && (
          <article className="mt-4 border-t border-amber-500/20 pt-4 prose prose-invert prose-sm max-w-none" data-testid="owners-desk-doc-view">
            <h3 className="!mt-0 !text-amber-200 font-mono text-sm">{docName(selected)}</h3>
            {docErr ? <p className="err">{docErr}</p> : docBody[selected] == null ? <p className="text-white/50">Loading…</p> : (
              <ReactMarkdown>{docBody[selected]}</ReactMarkdown>
            )}
          </article>
        )}
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-[#0b0a07] p-4 sm:p-5" data-testid="owners-desk-gallery">
        <div className="text-[11px] uppercase tracking-wider text-amber-300/80">Screenshots</div>
        {data.images.length === 0 ? (
          <p className="text-sm text-white/50 mt-2" data-testid="owners-desk-gallery-empty">No screenshots have been synced yet.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {data.images.map((img) => (
              <button
                key={img.path}
                type="button"
                onClick={() => img.hasImage && setLightbox(img.src)}
                className="group text-left"
                data-testid="owners-desk-shot"
              >
                {img.hasImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.src} alt={docName(img.path)} className="w-full h-28 object-cover rounded-lg border border-amber-500/20 group-hover:border-amber-300/60 bg-black" />
                ) : (
                  <div className="w-full h-28 rounded-lg border border-amber-500/20 bg-black/40 text-[10px] text-white/40 flex items-center justify-center">Metadata only</div>
                )}
                <div className="mt-1 text-[10px] font-mono text-white/45 truncate">{docName(img.path)}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={() => setLightbox(null)} data-testid="owners-desk-lightbox">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-h-full max-w-full rounded-lg border border-amber-500/40" />
        </div>
      )}
    </section>
  );
}
