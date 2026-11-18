'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import CollectivePnlTicker from '@/components/CollectivePnlTicker';
import { CommunityFeed } from '@/components/CommunityFeed';

type AuditFinding = { label: string; detail: string; severity: 'info' | 'watch' | 'high' };
type AuditResult = {
  wallet: string;
  status: 'clean' | 'watch' | 'high_risk' | 'unknown';
  summary: string;
  tokensCreated: number;
  relatedWallets: number;
  findings: AuditFinding[];
  announced: boolean;
  pendingModeration?: boolean;
};

function shortAddr(value: string) {
  if (!value || value.length < 12) return value || '—';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export default function CommunityPage() {
  const [auditWallet, setAuditWallet] = useState('');
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [lastAudit, setLastAudit] = useState<AuditResult | null>(null);
  const [feedKey, setFeedKey] = useState(0);

  const runAudit = useCallback(async () => {
    const wallet = auditWallet.trim();
    setAuditError('');
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      setAuditError('That does not look like a Solana address.');
      return;
    }
    setAuditing(true);
    try {
      const res = await fetch('/api/community/dev-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuditError(data.error ?? 'Audit failed. Try again.');
        return;
      }
      setLastAudit({
        wallet: data.wallet ?? wallet,
        status: data.status ?? 'unknown',
        summary: data.summary ?? 'Audit completed.',
        tokensCreated: data.tokensCreated ?? 0,
        relatedWallets: data.relatedWallets ?? 0,
        findings: Array.isArray(data.findings) ? data.findings : [],
        announced: Boolean(data.announced),
        pendingModeration: Boolean(data.pendingModeration),
      });
      setFeedKey((key) => key + 1);
    } catch {
      setAuditError('Audit failed. Try again.');
    } finally {
      setAuditing(false);
    }
  }, [auditWallet]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col pb-24 md:pb-8">
      <header className="border-b border-white/10 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <Link href="/app" className="flex items-center gap-3 min-w-0">
            <Image src="/cletus-logo.png" alt="Cletus" width={40} height={40} className="object-contain shrink-0" priority />
            <div className="min-w-0">
              <div className="font-bold text-lg leading-none">Cletus</div>
              <div className="text-xs text-white/50 mt-0.5">Community</div>
            </div>
          </Link>
          <nav className="flex items-center gap-3 text-xs" aria-label="Community sections">
            <Link href="/app/signals" className="text-white/50 hover:text-white">Signals</Link>
            <Link href="/app/chart" className="text-white/50 hover:text-white">Chart</Link>
            <Link href="/app/wallet" className="text-white/50 hover:text-white">Wallet</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 px-4 sm:px-6 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Community</h1>
            <p className="text-sm text-white/50 mt-1">A moderated feed. Public posts use anonymous labels. Pending, approved, and rejected posts stay visible to their author.</p>
          </div>
          <CollectivePnlTicker />
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
              <CommunityFeed key={feedKey} />
            </div>
            <section className="lg:col-span-2 space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wider">Dev Wallet Audit</h2>
                  <p className="text-xs text-white/50 mt-1.5 leading-relaxed">Paste a developer wallet. If you have opted in, the result is submitted to the feed and waits for moderation.</p>
                </div>
                <input value={auditWallet} onChange={(event) => { setAuditWallet(event.target.value); setAuditError(''); }} placeholder="Solana address…" className="w-full text-sm font-mono px-3 py-2.5 rounded-lg bg-black border border-white/15" spellCheck={false} autoComplete="off" />
                {auditError && <p className="text-xs text-red-400">{auditError}</p>}
                <button type="button" onClick={runAudit} disabled={auditing} className="w-full py-3 rounded-xl text-sm font-semibold bg-yellow-500 text-black disabled:opacity-40">{auditing ? 'Auditing…' : 'Run audit'}</button>
              </div>
              {lastAudit && (
                <div className="rounded-xl border border-white/10 p-5 space-y-2 text-sm">
                  <div className="flex justify-between gap-2 text-xs"><span className="uppercase tracking-wider">Last audit</span><span className="font-mono">{shortAddr(lastAudit.wallet)}</span></div>
                  <p>{lastAudit.summary}</p>
                  <p className="text-xs text-white/50">{lastAudit.pendingModeration ? 'Submitted for moderation.' : 'Not posted. Opt in if you want the community to review it.'}</p>
                  {lastAudit.findings.map((finding) => <p key={finding.label} className="text-xs text-white/70"><span className="font-semibold">{finding.label}</span> — {finding.detail}</p>)}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
