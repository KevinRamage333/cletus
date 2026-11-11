'use client';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function NewsPanel({ isAdmin }: { isAdmin?: boolean }) {
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState<'briefing' | 'headlines'>('briefing');
  const [busy, setBusy] = useState(false);
  async function load() { const r = await fetch('/api/brain/news', { cache: 'no-store' }); if (r.ok) setD(await r.json()); }
  useEffect(() => { load(); const t = setInterval(load, 120_000); return () => clearInterval(t); }, []);
  async function refresh() { setBusy(true); await fetch('/api/brain/news', { method: 'POST' }); await load(); setBusy(false); }
  return (
    <div className="card">
      <h2 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>World events</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button className={`btn small ${tab === 'briefing' ? 'primary' : ''}`} onClick={() => setTab('briefing')}>Briefing</button>
          <button className={`btn small ${tab === 'headlines' ? 'primary' : ''}`} onClick={() => setTab('headlines')}>Headlines</button>
          {isAdmin && <button className="btn small" disabled={busy} onClick={refresh}>{busy ? '…' : '↻'}</button>}
        </span>
      </h2>
      {!d ? <div className="muted">Loading news…</div> : tab === 'briefing' ? (
        <div className="scroll md" style={{ maxHeight: 260, fontSize: 13 }}>
          {d.briefing ? <ReactMarkdown>{d.briefing.content}</ReactMarkdown> : <span className="muted">No briefing yet.</span>}
          {d.briefing && <div className="muted" style={{ fontSize: 11 }}>{d.briefing.source} · {d.briefing.itemsCount} headlines · {new Date(d.briefing.at).toLocaleTimeString()}</div>}
        </div>
      ) : (
        <div className="scroll" style={{ maxHeight: 260, fontSize: 13 }}>
          {d.items.length === 0 && <span className="muted">No headlines yet.</span>}
          {d.items.map((i: any) => (
            <div key={i.url} style={{ marginBottom: 6 }}><span className="badge">{i.category}</span> <a href={i.url} target="_blank" rel="noreferrer">{i.title}</a> <span className="muted" style={{ fontSize: 11 }}>{i.source}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}
