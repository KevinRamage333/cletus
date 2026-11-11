'use client';
/** Owner-only Withdraw (operator trading wallet). Works only on the worker that holds the key; elsewhere it shows why. */
import { useCallback, useEffect, useState } from 'react';

type Status = { available: false; reason: string } | {
  available: true; mode: 'simulation' | 'live'; liveEnabled: boolean; operator: string; balanceSol: number | null; reserveSol: number; openPositions: number;
  history: Array<{ at: string; to: string; sol: number; mode: string; status: string; signature: string | null; error: string | null; closedPositions: number }>;
};
type Preview = { token: string; expiresInSec: number; confirmWord: string; summary: { from: string; to: string; amountSol: number | null; max: boolean; currentBalanceSol: number; reserveSol: number; feeSol: number; closePositions: boolean; mode: string; liveEnabled: boolean; note: string } };
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export default function WithdrawPanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [to, setTo] = useState(''); const [amount, setAmount] = useState(''); const [max, setMax] = useState(false); const [closeAll, setCloseAll] = useState(false);
  const [pv, setPv] = useState<Preview | null>(null); const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/protected/withdraw/status', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      setSt(r.ok ? d : { available: false, reason: 'Available when the trading worker is online' });
    } catch { setSt({ available: false, reason: 'Available when the trading worker is online' }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addrOk = B58.test(to.trim());
  const preview = async () => {
    setErr(null); setDone(null); setBusy(true);
    try {
      const r = await fetch('/api/protected/withdraw/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: to.trim(), amountSol: max ? undefined : Number(amount), max, closePositions: closeAll }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'preview failed'); setPv(d); setWord('');
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const confirm = async () => {
    if (!pv) return; setErr(null); setBusy(true);
    try {
      const r = await fetch('/api/protected/withdraw/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: pv.token, confirm: word }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.message ?? d.error ?? 'withdraw failed');
      setDone(d.message + (d.signature ? ` · ${d.signature}` : '')); setPv(null); setTo(''); setAmount(''); setMax(false); setCloseAll(false); load();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const card = 'rounded-2xl border border-amber-500/30 bg-zinc-950 p-5 space-y-3';
  if (!st) return <div className={card}><h2 className="text-sm font-semibold text-amber-300">Withdraw</h2><p className="text-xs text-zinc-500">Checking…</p></div>;
  if (!st.available) return (
    <div className={card} data-testid="withdraw-unavailable">
      <h2 className="text-sm font-semibold text-amber-300">Withdraw (owner)</h2>
      <p className="text-sm text-zinc-400">{st.reason}.</p>
    </div>
  );
  return (
    <div className={card} data-testid="withdraw-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-amber-300">Withdraw from the trading wallet (owner)</h2>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${st.mode === 'live' ? 'border-red-500 text-red-300' : 'border-amber-500/40 text-amber-300'}`}>{st.mode === 'live' ? (st.liveEnabled ? 'LIVE' : 'LIVE · sends disabled') : 'SIMULATION · nothing is sent'}</span>
      </div>
      <p className="text-xs text-zinc-500">From <span className="font-mono">{short(st.operator)}</span> · balance {st.balanceSol === null ? 'unknown' : `${st.balanceSol.toFixed(6)} SOL`} · keeps {st.reserveSol} SOL for fees/rent · {st.openPositions} open position(s)</p>
      {!pv && (<>
        <label className="block text-xs text-zinc-400">Destination Solana address
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Recipient wallet address" spellCheck={false} className={`mt-1 w-full px-3 py-2 rounded-lg bg-zinc-900 border font-mono text-sm ${to && !addrOk ? 'border-red-500' : 'border-zinc-700'}`} />
        </label>
        {to && !addrOk && <p className="text-xs text-red-400">Not a valid Solana address (base58, 32–44 characters).</p>}
        <div className="flex gap-2 items-end">
          <label className="block text-xs text-zinc-400 flex-1">Amount (SOL)
            <input value={max ? '' : amount} disabled={max} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={max ? 'Max (balance − reserve)' : '0.00'} className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm" />
          </label>
          <button type="button" onClick={() => setMax(!max)} className={`px-3 py-2 rounded-lg border text-sm ${max ? 'border-amber-400 text-amber-300' : 'border-zinc-700 text-zinc-300'}`}>Max</button>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={closeAll} onChange={(e) => setCloseAll(e.target.checked)} /> Close all open positions first</label>
        <button disabled={busy || !addrOk || (!max && !(Number(amount) > 0))} onClick={preview} className="px-4 py-2 rounded-lg bg-amber-400 text-black font-semibold disabled:opacity-40">Review withdrawal</button>
      </>)}
      {pv && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-2 text-sm" data-testid="withdraw-confirm">
          <div><span className="text-zinc-500">To</span> <span className="font-mono break-all">{pv.summary.to}</span></div>
          <div><span className="text-zinc-500">Amount</span> {pv.summary.max ? `Max (balance − ${pv.summary.reserveSol} SOL reserve)` : `${pv.summary.amountSol} SOL`} · fee ≈ {pv.summary.feeSol} SOL</div>
          {pv.summary.closePositions && <div className="text-amber-300">All open positions will be closed first.</div>}
          <div className={pv.summary.mode === 'live' ? 'text-red-300' : 'text-amber-200'}>{pv.summary.note}</div>
          <label className="block text-xs text-zinc-400">Type <strong>{pv.confirmWord}</strong> to confirm (expires in {pv.expiresInSec}s)
            <input value={word} onChange={(e) => setWord(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm" />
          </label>
          <div className="flex gap-2">
            <button disabled={busy || word !== pv.confirmWord} onClick={confirm} className="px-4 py-2 rounded-lg bg-amber-400 text-black font-semibold disabled:opacity-40">Confirm withdrawal</button>
            <button onClick={() => setPv(null)} className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300">Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="text-sm text-red-400">{err}</p>}
      {done && <p className="text-sm text-emerald-300">{done}</p>}
      {st.history.length > 0 && (
        <div className="pt-2">
          <h3 className="text-xs text-zinc-500 mb-1">Recent withdrawals</h3>
          <ul className="text-xs text-zinc-400 space-y-1">{st.history.map((h, i) => (
            <li key={i}>{new Date(h.at).toLocaleString()} · {h.sol.toFixed(6)} SOL → <span className="font-mono">{short(h.to)}</span> · {h.status}{h.signature ? ` · ${short(h.signature)}` : ''}{h.error ? ` · ${h.error}` : ''}</li>))}
          </ul>
        </div>
      )}
    </div>
  );
}
