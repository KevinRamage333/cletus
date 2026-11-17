'use client';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Refreshed, StateBox, Stat } from '@/components/app/ui';
import { useMovers } from '@/components/market/useMovers';
import { COMMUNITY_NETWORKS } from '@/lib/community-overview';

type Overview = { connected: true; updatedAt: string; participants: number; activeNow: number; collectivePnl: { suppressed: true; minContributors: number } | { suppressed: false; netUsd: number; gainsUsd: number; lossesUsd: number; closedTrades: number }; tokensPerNetwork: Record<string, number> };
type Status = { kind: 'loading' } | { kind: 'ok'; data: Overview } | { kind: 'signin' } | { kind: 'not-connected'; reason: string } | { kind: 'error'; reason: string };
const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

export default function CommunityStats({ demo }: { demo: boolean }) {
  const [s, setS] = useState<Status>({ kind: 'loading' });
  const { data: board, state: boardState } = useMovers(30_000);
  const load = useCallback(async () => {
    if (demo) { setS({ kind: 'not-connected', reason: 'The public preview has no member database connected.' }); return; }
    try {
      const res = await fetch('/api/community/overview', { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      if (res.status === 401 || res.status === 403) { setS({ kind: 'signin' }); return; }
      if (res.status === 503) { setS({ kind: 'not-connected', reason: 'Member data is not connected on this deployment.' }); return; }
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.connected) throw new Error(j?.error || `HTTP ${res.status}`);
      setS({ kind: 'ok', data: j });
    } catch (e) { setS({ kind: 'error', reason: e instanceof Error ? e.message : 'unavailable' }); }
  }, [demo]);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 60_000); return () => window.clearInterval(t); }, [load]);

  const d = s.kind === 'ok' ? s.data : null;
  const pnl = d?.collectivePnl;
  const na = s.kind === 'loading' ? '…' : '—';
  const naSub = s.kind === 'signin' ? 'Sign in to view' : s.kind === 'not-connected' ? 'Not yet connected' : s.kind === 'error' ? 'Unavailable' : undefined;
  const scanning = boardState === 'ready' ? board?.tokens.length ?? null : null;

  return (
    <div>
      <PageHeader eyebrow="Gold community" title="Who Cletus trades for" actions={d ? <Refreshed at={d.updatedAt} /> : undefined}>
        Aggregated, privacy-conscious figures from recorded paper trades. Individual accounts are never shown, and collective P&amp;L is hidden until at least five members contribute.
      </PageHeader>
      {s.kind === 'not-connected' && <div className="mb-4"><StateBox kind="not-connected" title="Community data not yet connected">{s.reason} Figures below show “—” instead of guessing.</StateBox></div>}
      {s.kind === 'signin' && <div className="mb-4"><StateBox kind="info" title="Sign in to see community figures">Community aggregates are available to members who completed onboarding.</StateBox></div>}
      {s.kind === 'error' && <div className="mb-4"><StateBox kind="error" title="Community data could not load" action={<button className="btn-line !py-1.5" onClick={() => void load()}>Retry</button>}>{s.reason}</StateBox></div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="community-stats">
        <Stat label="People Cletus trades for" value={d ? d.participants.toLocaleString('en-US') : na} sub={d ? `${d.activeNow} with open paper positions` : naSub} testId="stat-people" />
        <Stat label="Collective P&L (paper, realized)" value={!pnl ? na : pnl.suppressed ? 'Hidden' : usd(pnl.netUsd)} tone={!pnl || pnl.suppressed ? 'muted' : pnl.netUsd >= 0 ? 'up' : 'down'} sub={!pnl ? naSub : pnl.suppressed ? `Needs ${pnl.minContributors}+ contributors` : `${pnl.closedTrades} closed trades · gains ${usd(pnl.gainsUsd)} · losses ${usd(pnl.lossesUsd)}`} testId="stat-pnl" />
        <Stat label="Tokens traded (all networks)" value={d ? Object.values(d.tokensPerNetwork).reduce((a, b) => a + b, 0).toLocaleString('en-US') : na} sub={d ? 'Distinct tokens with paper trades' : naSub} testId="stat-tokens" />
        <Stat label="Tokens scanned now" value={scanning == null ? (boardState === 'loading' ? '…' : '—') : scanning.toLocaleString('en-US')} sub="Live Solana board (DexScreener)" testId="stat-scanned" />
      </div>

      <h3 className="mb-3 mt-8 text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Network coverage</h3>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm" data-testid="network-coverage">
        <thead><tr className="border-b border-[rgba(212,175,55,.25)] text-[10px] uppercase tracking-[.16em] text-[#c9a24a]"><th className="py-2 pr-3">Network</th><th className="py-2 pr-3">Wallet connect</th><th className="py-2 pr-3">Market scan</th><th className="py-2 pr-3">Paper trading</th><th className="py-2">Tokens traded</th></tr></thead>
        <tbody>{COMMUNITY_NETWORKS.map((n) => (
          <tr key={n.id} className="border-b border-white/5">
            <td className="py-2.5 pr-3 font-semibold text-[#f6f1e4]">{n.name} <span className="text-xs text-[#8a8478]">{n.symbol}</span></td>
            <td className="py-2.5 pr-3">{n.walletConnect ? <span className="text-emerald-300">● Ready</span> : <span className="text-[#8a8478]">○ Planned</span>}</td>
            <td className="py-2.5 pr-3">{n.marketData ? <span className="text-emerald-300">● Live</span> : <span className="text-[#8a8478]">○ Planned</span>}</td>
            <td className="py-2.5 pr-3">{n.paperTrading ? <span className="text-emerald-300">● Live</span> : <span className="text-[#8a8478]">○ Planned</span>}</td>
            <td className="num py-2.5">{d ? d.tokensPerNetwork[n.id] ?? 0 : <span className="text-[#8a8478]" title={naSub}>—</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="mt-3 text-[11px] text-[#8a8478]">“Ready” means the wallet connector works today (connect, address, native balance). Paper trading and market scanning beyond Solana are planned and shown honestly as such.</p>
    </div>
  );
}
