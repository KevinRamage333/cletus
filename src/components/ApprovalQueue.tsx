'use client';
import { Buffer } from 'buffer';
import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { canApprove, formatTimer, remainingMs, solscanTxUrl, type ApprovalRecord } from '@/lib/approvals';

type Props = {
  approvals: ApprovalRecord[];
  demo?: boolean;
  onChange?: () => void;
};

export default function ApprovalQueue({ approvals, demo, onChange }: Props) {
  const { signTransaction, connected } = useWallet();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const pending = useMemo(
    () => approvals.filter((a) => a.status === 'pending' && remainingMs(a.expiresAt, now) > 0),
    [approvals, now],
  );

  async function approve(row: ApprovalRecord) {
    if (demo) { setErr('This is a public demo preview. Approvals are not submitted until accounts open.'); return; }
    const check = canApprove(row, Date.now());
    if (!check.ok) { setErr(check.error); return; }
    if (!connected || !signTransaction) { setErr('Connect your wallet to approve this swap.'); return; }
    setBusy(row.id); setErr(null);
    try {
      const raw = Uint8Array.from(atob(row.transaction!), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(raw);
      const signed = await signTransaction(tx);
      const signedTransaction = Buffer.from(signed.serialize()).toString('base64');
      const r = await fetch(`/api/protected/approvals/${row.id}/execute`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signedTransaction }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'approve failed');
      onChange?.();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function reject(row: ApprovalRecord) {
    if (demo) { onChange?.(); setErr('Preview only — nothing was sent.'); return; }
    setBusy(row.id); setErr(null);
    try {
      const r = await fetch(`/api/protected/approvals/${row.id}/reject`, { method: 'POST', credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'reject failed');
      onChange?.();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#121212] p-4 space-y-3" data-testid="approval-queue">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold">Approval queue</h2>
        <span className="text-[11px] text-white/40">{pending.length} waiting</span>
      </div>
      <p className="text-xs text-white/45 leading-relaxed">
        Cletus prepares each Jupiter swap. You approve it in your wallet — one tap, one signature, a short timer. He never holds your keys and never trades without you.
        {demo ? ' This preview does not submit a real transaction.' : ''}
      </p>
      {err && <div className="err text-sm">{err}</div>}
      {pending.length === 0 && (
        <p className="text-sm text-white/40">No swaps waiting for your approval. Paper trades run automatically; live suggestions will show up here.</p>
      )}
      {pending.map((row) => {
        const left = remainingMs(row.expiresAt, now);
        const fee = row.operatorFeeUsd ?? null;
        const bps = row.operatorFeeBps ?? 50;
        return (
          <div key={row.id} className="rounded-xl border border-amber-500/30 bg-black/40 p-4 space-y-3" data-testid="approval-item">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{row.side === 'buy' ? 'Buy' : 'Sell'} {row.symbol}</div>
                <div className="text-xs text-white/50 mt-0.5">${row.sizeUsd.toFixed(2)} · score {row.score?.toFixed(2) ?? '—'}</div>
              </div>
              <div className={`text-sm font-mono ${left <= 10_000 ? 'text-red-400' : 'text-amber-300'}`}>{formatTimer(left)}</div>
            </div>
            {row.reason && <p className="text-xs text-white/60">{row.reason}</p>}
            <div className="text-xs text-white/50">
              Platform fee ({(bps / 100).toFixed(1)}%): <span className="text-amber-300 font-mono">{fee === null ? 'Unavailable' : `$${fee.toFixed(2)}`}</span> ({bps} bps)
              {row.priceImpactPct != null ? ` · impact ${row.priceImpactPct.toFixed(2)}%` : ''}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn primary small" disabled={busy === row.id || left <= 0} onClick={() => approve(row)} data-testid="approve-trade">
                {busy === row.id ? 'Approving…' : 'Approve in wallet'}
              </button>
              <button type="button" className="btn small" disabled={busy === row.id} onClick={() => reject(row)}>Skip</button>
            </div>
          </div>
        );
      })}
      {approvals.filter((a) => a.status === 'executed' && a.signature).slice(0, 3).map((a) => {
        const href = solscanTxUrl(a.signature);
        return href ? (
          <p key={a.id} className="text-xs text-white/45">Last approved {a.symbol}: <a href={href} target="_blank" rel="noreferrer" className="text-amber-300">Solscan</a></p>
        ) : null;
      })}
    </section>
  );
}
