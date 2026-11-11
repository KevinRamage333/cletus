'use client';
import { useEffect, useState } from 'react';

interface Item { id: string; kind: string; severity: string | null; message: string; page: string | null; email: string; at: string }

export default function FeedbackPage() {
  const [kind, setKind] = useState('bug');
  const [severity, setSeverity] = useState('medium');
  const [message, setMessage] = useState('');
  const [page, setPage] = useState('dashboard');
  const [status, setStatus] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const load = () => fetch('/api/feedback').then((r) => r.json()).then((j) => setItems(j.items ?? []));
  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, severity, message, page }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setStatus(j.error ?? 'failed');
    setStatus('Thanks — submitted.'); setMessage(''); load();
  }

  return (
    <div className="dash" style={{ maxWidth: 900 }}>
      <div className="topbar"><h1>Beta feedback &amp; bug reports</h1><a className="btn small" href="/">← Dashboard</a></div>
      <form className="card" onSubmit={submit}>
        <label>Type</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="bug">Bug</option><option value="feedback">Feedback</option><option value="idea">Idea</option></select>
        {kind === 'bug' && (<><label>Severity</label><select value={severity} onChange={(e) => setSeverity(e.target.value)}><option>low</option><option>medium</option><option>high</option><option>critical</option></select></>)}
        <label>Where (page / feature)</label>
        <input value={page} onChange={(e) => setPage(e.target.value)} />
        <label>What happened? (steps to reproduce, expected vs actual)</label>
        <textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} required />
        <div style={{ marginTop: 12 }}><button className="btn primary">Submit</button> {status && <span className="muted">{status}</span>}</div>
      </form>
      <div className="card" style={{ marginTop: 14 }}>
        <h2>Submitted</h2>
        <table><thead><tr><th>When</th><th>Type</th><th>Sev</th><th>From</th><th>Message</th></tr></thead>
          <tbody>{items.map((f) => <tr key={f.id}><td>{new Date(f.at).toLocaleString()}</td><td>{f.kind}</td><td>{f.severity ?? ''}</td><td>{f.email}</td><td style={{ whiteSpace: 'pre-wrap' }}>{f.message}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
