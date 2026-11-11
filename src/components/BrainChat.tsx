'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Msg { role: 'user' | 'model'; content: string; meta?: any }
interface Conv { id: string; title: string; updatedAt: string; messages: number }

const GREETING: Msg = { role: 'model', content: "I'm Cletus. Ask me about my positions, P&L, what I've learned, my health, or what's happening in the world. I'm advisory only. The signal engine makes the trades." };

function metaLabel(m: any) {
  if (!m) return '';
  const src = m.source === 'gemini-grounded' ? `Gemini · ${m.model} · web-grounded` : m.source === 'gemini' ? `Gemini · ${m.model}`
    : m.source === 'xai-web' ? `Grok · ${m.model} · web search` : m.source === 'xai' ? `Grok · ${m.model}` : m.refused ? 'guardrail: advisory only' : 'offline mock';
  return `${src}${m.tools?.length ? ` · read: ${m.tools.join(', ')}` : ''}`;
}

export default function BrainChat({ account, full = false }: { account?: string; full?: boolean }) {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [cid, setCid] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const loadConvs = useCallback(async () => {
    const r = await fetch('/api/brain', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); setConvs(j.conversations); return j.conversations as Conv[]; }
    return [];
  }, []);
  const open = useCallback(async (id: string) => {
    const r = await fetch(`/api/brain?conversationId=${id}`, { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    setCid(id);
    setMsgs([GREETING, ...j.messages.map((m: any) => ({ role: m.role, content: m.content, meta: m.meta }))]);
    try { localStorage.setItem('cletus_conv', id); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadConvs().then((list) => {
      let last: string | null = null;
      try { last = localStorage.getItem('cletus_conv'); } catch { /* ignore */ }
      const pick = list.find((c) => c.id === last) ?? list[0];
      if (pick) open(pick.id);
    });
  }, [loadConvs, open]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  function newChat() { setCid(null); setMsgs([GREETING]); try { localStorage.removeItem('cletus_conv'); } catch { /* ignore */ } }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question || busy) return;
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setQ(''); setBusy(true);
    try {
      const r = await fetch('/api/brain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, account, conversationId: cid }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'failed');
      if (j.conversationId !== cid) { setCid(j.conversationId); try { localStorage.setItem('cletus_conv', j.conversationId); } catch { /* ignore */ } loadConvs(); }
      setMsgs((m) => [...m, { role: 'model', content: j.answer, meta: { source: j.source, model: j.model, tools: j.tools, sources: j.sources, refused: j.refused } }]);
    } catch (err) {
      setMsgs((m) => [...m, { role: 'model', content: `error: ${(err as Error).message}` }]);
    } finally { setBusy(false); }
  }

  return (
    <div className={full ? 'chat-full' : ''}>
      {full && (
        <aside className="conv-list">
          <button className="btn small" onClick={newChat} style={{ width: '100%', marginBottom: 8 }}>+ New chat</button>
          {convs.map((c) => (
            <div key={c.id} className={`conv ${c.id === cid ? 'active' : ''}`} onClick={() => open(c.id)}>{c.title}<div className="muted" style={{ fontSize: 11 }}>{c.messages} msgs</div></div>
          ))}
        </aside>
      )}
      <div className="chat" style={full ? { height: 'calc(100vh - 160px)', flex: 1 } : undefined}>
        <div className="msgs">
          {msgs.map((m, i) => (
            <div key={i} className={`m ${m.role === 'user' ? 'me' : ''}`}>
              {m.role === 'user' ? m.content : <div className="md"><img className="avatar" src="/cletus-avatar.png" alt="Cletus" /><ReactMarkdown>{m.content}</ReactMarkdown></div>}
              {m.meta && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{metaLabel(m.meta)}</div>}
              {m.meta?.sources?.length > 0 && <div style={{ fontSize: 11, marginTop: 2 }}>{m.meta.sources.slice(0, 5).map((s: any, k: number) => <a key={k} href={s.url} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>[{k + 1}] {s.title}</a>)}</div>}
            </div>
          ))}
          {busy && <div className="m muted"><img className="avatar" src="/cletus-avatar.png" alt="" />Cletus is thinking…</div>}
          <div ref={end} />
        </div>
        <form onSubmit={send}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Talk to Cletus…" maxLength={2000} />
          <button className="btn" disabled={busy}>{busy ? '…' : 'Send'}</button>
          {!full && <a className="btn small" href="/brain" title="Open full chat">⤢</a>}
        </form>
      </div>
    </div>
  );
}
