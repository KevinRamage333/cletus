'use client';
import { useEffect, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function JournalPanel({ account }: { account?: string }) {
  const [e, setE] = useState<any[] | null>(null);
  useEffect(() => {
    const load = async () => { const r = await fetch(`/api/brain/journal${account ? `?account=${account}` : ''}`, { cache: 'no-store' }); if (r.ok) setE((await r.json()).entries); };
    load(); const t = setInterval(load, 30_000); return () => clearInterval(t);
  }, [account]);
  return (
    <div className="card">
      <h2>Self-reflection journal</h2>
      <div className="scroll" style={{ maxHeight: 220, fontSize: 13 }}>
        {!e ? <span className="muted">Loading…</span> : e.length === 0 ? <span className="muted">No entries yet. Cletus writes one after every closed trade and a daily summary.</span> :
          e.map((j) => <div key={j.id} style={{ marginBottom: 8 }}><b>{j.title}</b> <span className="muted" style={{ fontSize: 11 }}>{new Date(j.at).toLocaleString()} · {j.source}</span><div>{j.content}</div></div>)}
      </div>
    </div>
  );
}
