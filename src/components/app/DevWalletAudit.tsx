'use client';

import { useCallback, useState } from 'react';

type AuditFinding = { label: string; detail: string; severity: 'info' | 'watch' | 'high' };
type AuditResult = {
  wallet: string;
  status: 'clean' | 'watch' | 'high_risk' | 'unknown';
  summary: string;
  /** null when the audit could not determine the figure. Never shown as 0. */
  tokensCreated: number | null;
  relatedWallets: number | null;
  findings: AuditFinding[];
  pendingModeration: boolean;
};

const finiteOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function shortAddr(value: string) {
  if (!value || value.length < 12) return value || '—';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** Developer-wallet audit. If the member has opted in, the result enters the moderated feed as a pending post. */
export default function DevWalletAudit({ onSubmitted }: { onSubmitted?: () => void }) {
  const [wallet, setWallet] = useState('');
  const [auditing, setAuditing] = useState(false);
  const [error, setError] = useState('');
  const [last, setLast] = useState<AuditResult | null>(null);

  const run = useCallback(async () => {
    const value = wallet.trim();
    setError('');
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
      setError('That does not look like a Solana address.');
      return;
    }
    setAuditing(true);
    try {
      const res = await fetch('/api/community/dev-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Audit failed. Try again.');
        return;
      }
      setLast({
        wallet: data.wallet ?? value,
        status: data.status ?? 'unknown',
        summary: data.summary ?? 'Audit completed.',
        tokensCreated: finiteOrNull(data.tokensCreated),
        relatedWallets: finiteOrNull(data.relatedWallets),
        findings: Array.isArray(data.findings) ? data.findings : [],
        pendingModeration: Boolean(data.pendingModeration),
      });
      onSubmitted?.();
    } catch {
      setError('Audit failed. Try again.');
    } finally {
      setAuditing(false);
    }
  }, [wallet, onSubmitted]);

  return (
    <div className="panel space-y-4 p-5">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Dev wallet audit</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-[#a39c8f]">Paste a developer wallet. If you have opted in, the result is submitted to the feed and waits for moderation.</p>
      </div>
      <input
        value={wallet}
        onChange={(event) => { setWallet(event.target.value); setError(''); }}
        placeholder="Solana address…"
        aria-label="Developer wallet address"
        className="w-full rounded-lg border border-white/15 bg-black px-3 py-2.5 font-mono text-sm"
        spellCheck={false}
        autoComplete="off"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button type="button" onClick={run} disabled={auditing} className="w-full rounded-xl bg-[#e3c06a] py-3 text-sm font-semibold text-black disabled:opacity-40">
        {auditing ? 'Auditing…' : 'Run audit'}
      </button>
      {last && (
        <div className="space-y-2 rounded-xl border border-white/10 p-4 text-sm">
          <div className="flex justify-between gap-2 text-xs"><span className="uppercase tracking-wider">Last audit</span><span className="font-mono">{shortAddr(last.wallet)}</span></div>
          <p>{last.summary}</p>
          <div className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className="rounded-lg bg-black/30 px-3 py-2">Tokens linked: <strong>{last.tokensCreated === null ? 'Unavailable' : last.tokensCreated}</strong></div>
            <div className="rounded-lg bg-black/30 px-3 py-2">Related wallets: <strong>{last.relatedWallets === null ? 'Unavailable' : last.relatedWallets}</strong></div>
          </div>
          <p className="text-xs text-[#a39c8f]">{last.pendingModeration ? 'Submitted for moderation.' : 'Not posted. Opt in if you want the community to review it.'}</p>
          {last.findings.map((finding) => <p key={finding.label} className="text-xs text-white/70"><span className="font-semibold">{finding.label}</span> — {finding.detail}</p>)}
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-white/30">Audits use public blockchain data and heuristics. A high-risk result is a community risk signal, not a legal determination.</p>
    </div>
  );
}
