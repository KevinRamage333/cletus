'use client';
/**
 * Owner desk: deposit addresses (QR) + REAL withdrawal requests. The site only
 * queues a confirmed request; the box worker executes it after checking its
 * allowlist, the daily cap and OWNER_REMOTE_WITHDRAW. Status comes back here.
 */
import { useCallback, useEffect, useState } from 'react';
import AddressQr from './AddressQr';
import BaseWalletConnect from './BaseWalletConnect';

type Req = { id: string; wallet: 'main' | 'kol'; to: string; lamports: number; createdAt: string; status: string; signature?: string | null; note?: string | null };
type Data = { deposit: Array<{ wallet: string; label: string; address: string }>; requests: Req[] };
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const COLORS: Record<string, string> = { sent: 'text-emerald-300', refused: 'text-amber-300', failed: 'text-red-400', expired: 'text-white/40', confirmed: 'text-sky-300', executing: 'text-sky-300' };

export default function OwnerFundsPanel() {
  const [d, setD] = useState<Data | null>(null);
  const [wallet, setWallet] = useState<'main' | 'kol'>('main');
  const [to, setTo] = useState(''); const [amount, setAmount] = useState('');
  const [pv, setPv] = useState<{ token: string; summary: string; confirmWord: string } | null>(null);
  const [word, setWord] = useState(''); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/owner/withdraw', { cache: 'no-store', credentials: 'include' }).catch(() => null);
    if (r?.ok) setD(await r.json());
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const call = async (body: object) => {
    const r = await fetch('/api/owner/withdraw', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? 'failed');
    return j;
  };
  const preview = async () => {
    setErr(null); setMsg(null); setBusy(true);
    try { const j = await call({ step: 'preview', wallet, to: to.trim(), amountSol: Number(amount) }); setPv(j); setWord(''); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const confirmSend = async () => {
    if (!pv) return; setErr(null); setBusy(true);
    try { const j = await call({ step: 'confirm', token: pv.token, confirmWord: word }); setMsg(j.message); setPv(null); setTo(''); setAmount(''); await load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="card p-4 space-y-4">
      <div className="flex items-center gap-2"><h3 className="font-bold">Funds: deposit &amp; withdraw</h3><span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-300">REAL · OWNER ONLY</span></div>
      <div className="grid gap-4 md:grid-cols-2">
        {(d?.deposit ?? []).map((w) => <AddressQr key={w.wallet} label={w.label} address={w.address} note="Send SOL or SPL tokens on Solana only." />)}
      </div>
      <BaseWalletConnect />
      <div className="space-y-2">
        <div className="text-sm font-semibold">Withdraw (real SOL, executed by the box worker)</div>
        <p className="text-[11px] text-white/50">Two steps every time: preview, then type WITHDRAW. The site never sends funds. The worker sends only to addresses on its allowlist, within the daily cap, and only while remote withdrawals are switched on for the worker. Every result is logged and shown below.</p>
        <div className="flex flex-wrap gap-2 items-center">
          <select className="input" value={wallet} onChange={(e) => { setWallet(e.target.value as 'main' | 'kol'); setPv(null); }}>
            <option value="main">From main wallet</option><option value="kol">From KOL wallet</option>
          </select>
          <input className="input flex-1 min-w-[16rem] font-mono text-xs" placeholder="Allowlisted Solana address" value={to} onChange={(e) => { setTo(e.target.value); setPv(null); }} />
          <input className="input w-28" inputMode="decimal" placeholder="SOL" value={amount} onChange={(e) => { setAmount(e.target.value); setPv(null); }} />
          <button type="button" className="btn small" disabled={busy || !to || !(Number(amount) > 0)} onClick={preview}>Preview</button>
        </div>
        {pv && (
          <div className="rounded border border-amber-500/40 p-3 space-y-2 text-sm">
            <div>{pv.summary}</div>
            <div className="flex gap-2 items-center">
              <input className="input w-40" placeholder={`Type ${pv.confirmWord}`} value={word} onChange={(e) => setWord(e.target.value)} />
              <button type="button" className="btn small" disabled={busy || word.trim().toUpperCase() !== pv.confirmWord} onClick={confirmSend}>Confirm &amp; queue</button>
              <button type="button" className="btn small" onClick={() => setPv(null)}>Cancel</button>
            </div>
          </div>
        )}
        {err && <div className="text-xs text-red-400">{err}</div>}
        {msg && <div className="text-xs text-emerald-300">{msg}</div>}
        {d?.requests?.length ? (
          <ul className="text-[11px] space-y-0.5">
            {d.requests.map((r) => (
              <li key={r.id} className="text-white/60">
                {new Date(r.createdAt).toLocaleString()} · {(r.lamports / 1e9).toFixed(4)} SOL {r.wallet} → {short(r.to)} · <span className={COLORS[r.status] ?? ''}>{r.status}</span>
                {r.signature && <> · <a className="underline" href={`https://solscan.io/tx/${r.signature}`} target="_blank" rel="noreferrer">tx</a></>}
                {r.note && <> · {r.note}</>}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
