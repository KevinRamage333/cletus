'use client';
import { useState } from 'react';
type M = { role: 'user' | 'assistant'; content: string };
const STARTERS = ['How does Cletus decide what to trade?', 'What does the token audit check?', 'Explain stop-loss vs take-profit', 'What is slippage on a DEX?'];
export default function DemoBrain() {
  const [msgs, setMsgs] = useState<M[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    const history = msgs; setMsgs([...msgs, { role: 'user', content: q }]); setText(''); setBusy(true);
    try {
      const r = await fetch('/api/demo/brain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: q, history }) });
      const d = await r.json();
      setMsgs((m) => [...m, { role: 'assistant', content: r.ok ? d.answer : `⚠ ${d.error ?? 'unavailable'}` }]);
    } catch { setMsgs((m) => [...m, { role: 'assistant', content: '⚠ network error' }]); }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><img src="/cletus-avatar.png" alt="" className="w-10 h-10 rounded-full" /><div><h1 className="text-2xl font-bold gold-text">Ask Cletus</h1><p className="text-xs text-zinc-500">Demo Brain (Gemini). No account access, rate-limited, educational only, not financial advice.</p></div></div>
      {msgs.length === 0 && <div className="flex flex-wrap gap-2">{STARTERS.map((s) => <button key={s} onClick={() => send(s)} className="px-3 py-1 rounded-full border border-zinc-700 text-sm text-zinc-300 hover:border-amber-400">{s}</button>)}</div>}
      <div className="space-y-3">{msgs.map((m, i) => (
        <div key={i} className={`rounded-xl p-3 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-zinc-900 border border-zinc-800 ml-10' : 'bg-amber-500/5 border border-amber-500/30 mr-10 text-zinc-200'}`}>{m.content.replace(/\*\*/g, '')}</div>))}
        {busy && <div className="text-sm text-amber-300">Cletus is thinking…</div>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Ask about markets, risk, or how Cletus works" className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-white" />
        <button disabled={busy} className="px-4 py-2 rounded-lg bg-amber-400 text-black font-semibold">Send</button>
      </form>
    </div>
  );
}
