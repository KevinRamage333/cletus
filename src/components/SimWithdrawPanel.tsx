'use client';
/** Every user: SIMULATED withdrawal of paper cash to their own connected wallet (Solana or Base app). No real funds move. */
import { useCallback, useEffect, useState } from 'react';
import { walletConnectEnabled } from '@/lib/wallet-flag';
import BaseWalletConnect, { useBaseAddress } from './BaseWalletConnect';

type St = { cashUsd: number; solanaWallet: string | null; history: Array<{ at: string; to: string; usd: number; status: string }> };
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export default function SimWithdrawPanel() {
  const [st, setSt] = useState<St | null>(null);
  const [base] = useBaseAddress();
  const [chain, setChain] = useState<'solana' | 'base'>('solana');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/protected/sim-withdraw', { cache: 'no-store' }).catch(() => null);
    if (r?.ok) setSt(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!st?.solanaWallet && base) setChain('base'); }, [st, base]);

  const to = chain === 'base' ? base : st?.solanaWallet ?? null;
  const submit = async () => {
    setErr(null); setMsg(null);
    if (!to) { setErr(chain === 'base' ? 'Connect your Base app wallet first' : 'Connect a Solana wallet first'); return; }
    if (!confirm(`SIMULATED withdrawal: $${Number(amount).toFixed(2)} of paper cash to your ${chain === 'base' ? 'Base app' : 'Solana'} wallet ${short(to)}.\n\nNo real funds move. Continue?`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/protected/sim-withdraw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain, to, amountUsd: Number(amount) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'failed');
      setMsg(j.message); setAmount(''); await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="font-bold">Deposit &amp; withdraw</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-sky-400/50 text-sky-300">SIMULATED</span>
      </div>
      <p className="text-xs text-white/55">Balances here are paper (simulation) money. Withdrawals go only to <b>your own connected wallet</b> and are simulated: they reduce your paper cash and are logged, but no real crypto is sent. Do not send real funds to deposit.</p>
      {walletConnectEnabled() && <BaseWalletConnect />}
      {st && <div className="text-sm">Simulated cash: <b>${st.cashUsd.toFixed(2)}</b></div>}
      <div className="flex flex-wrap gap-2 items-center">
        <select className="input" value={chain} onChange={(e) => setChain(e.target.value as 'solana' | 'base')}>
          <option value="solana">My Solana wallet {st?.solanaWallet ? `(${short(st.solanaWallet)})` : '(not connected)'}</option>
          <option value="base">My Base app wallet {base ? `(${short(base)})` : '(not connected)'}</option>
        </select>
        <input className="input w-32" inputMode="decimal" placeholder="USD" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="button" className="btn small" disabled={busy || !(Number(amount) > 0)} onClick={submit}>{busy ? 'Working…' : 'Withdraw (simulated)'}</button>
      </div>
      {err && <div className="text-xs text-red-400">{err}</div>}
      {msg && <div className="text-xs text-emerald-300">{msg}</div>}
      {st?.history?.length ? (
        <ul className="text-[11px] text-white/55 space-y-0.5">
          {st.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} · ${h.usd.toFixed(2)} → {short(h.to.replace(/^\w+:/, ''))} · {h.status}</li>)}
        </ul>
      ) : null}
    </section>
  );
}
