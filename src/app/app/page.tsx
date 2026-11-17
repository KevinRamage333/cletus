'use client';

/**
 * App home / personal dashboard
 * Tracks this user's PnL, win rate, positions, Sharpe, best/worst trade.
 * Layout matches the performance cards style (24h PnL, etc.).
 * Black background, logo on every page.
 * Route: /app (personal dashboard)
 */

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import HeaderCard from '@/components/HeaderCard';
import TradingNetworks from '@/components/TradingNetworks';
import CollectivePnlTicker from '@/components/CollectivePnlTicker';
import ApprovalQueue from '@/components/ApprovalQueue';
import LivePortfolio, { type PortfolioPosition, type PortfolioTrade } from '@/components/LivePortfolio';
import ConnectWallet from '@/components/ConnectWallet';
import type { ApprovalRecord } from '@/lib/approvals';

type UserStats = {
  pnl24h: number;
  pnl24hPercent: number;
  winRate: number;
  activePositions: number;
  totalTrades: number;
  bestTrade: number;
  worstTrade: number;
  sharpeRatio: number;
  trialActive?: boolean;
  daysRemaining?: number;
  winRateKnown?: boolean;
  sharpeKnown?: boolean;
  maxPositions?: number;
  bestSymbol?: string | null;
  worstSymbol?: string | null;
  equity?: number;
  cash?: number;
  startingBalance?: number;
  realizedPnl?: number;
  unrealized?: number;
  totalPnl?: number;
  operatorFeeBps?: number;
  open?: PortfolioPosition[];
  closed?: PortfolioTrade[];
  approvals?: ApprovalRecord[];
  wallet?: { address: string | null; source: string | null; connected: boolean };
};

const EMPTY_STATS: UserStats = {
  pnl24h: 0,
  pnl24hPercent: 0,
  winRate: 0,
  activePositions: 0,
  totalTrades: 0,
  bestTrade: 0,
  worstTrade: 0,
  sharpeRatio: 0,
  trialActive: false,
  daysRemaining: 0,
  equity: 0,
  cash: 0,
  startingBalance: 0,
  realizedPnl: 0,
  unrealized: 0,
  totalPnl: 0,
  operatorFeeBps: 50,
  open: [],
  closed: [],
  approvals: [],
  wallet: { address: null, source: 'paper', connected: false },
};

function formatUsd(n: number, showSign = false) {
  const abs = Math.abs(n);
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  if (!showSign) return n < 0 ? `-${formatted}` : formatted;
  return `${n >= 0 ? '+' : '-'}${formatted}`;
}

function StatCard({
  label,
  value,
  sub,
  positive,
  neutral,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  neutral?: boolean;
  icon: string;
}) {
  const valueColor = neutral
    ? 'text-sky-400'
    : positive
    ? 'text-emerald-400'
    : 'text-red-400';

  return (
    <div className="rounded-2xl border border-white/10 bg-[#121212] p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-white/40 uppercase tracking-wider font-medium">
          {label}
        </span>
        <span className="text-base leading-none">{icon}</span>
      </div>
      <div className={`text-2xl font-bold font-mono tabular-nums ${valueColor}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-white/40">{sub}</div>}
    </div>
  );
}

export default function AppDashboardPage() {
  const [stats, setStats] = useState<UserStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Personal stats for the logged-in user only
      // Wire: GET /api/protected/stats or /api/protected/pnl
      const res = await fetch('/api/protected/stats', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStats({
          pnl24h: Number(data.pnl24h) || 0,
          pnl24hPercent: Number(data.pnl24hPercent) || 0,
          winRate: Number(data.winRate) || 0,
          activePositions: Number(data.activePositions) || 0,
          totalTrades: Number(data.totalTrades) || 0,
          bestTrade: Number(data.bestTrade) || 0,
          worstTrade: Number(data.worstTrade) || 0,
          sharpeRatio: Number(data.sharpeRatio) || 0,
          trialActive: data.trialActive !== false,
          daysRemaining: data.daysRemaining ?? 0,
          winRateKnown: !!data.winRateKnown,
          sharpeKnown: !!data.sharpeKnown,
          maxPositions: Number(data.maxPositions) || 0,
          bestSymbol: data.bestSymbol ?? null,
          worstSymbol: data.worstSymbol ?? null,
          equity: Number(data.equity) || 0,
          cash: Number(data.cash) || 0,
          startingBalance: Number(data.startingBalance) || 0,
          realizedPnl: Number(data.realizedPnl) || 0,
          unrealized: Number(data.unrealized) || 0,
          totalPnl: Number(data.totalPnl) || Number(data.realizedPnl || 0) + Number(data.unrealized || 0),
          operatorFeeBps: Number(data.operatorFeeBps) || 50,
          open: Array.isArray(data.open) ? data.open : [],
          closed: Array.isArray(data.closed) ? data.closed : [],
          approvals: Array.isArray(data.approvals) ? data.approvals : [],
          wallet: data.wallet ?? { address: null, source: 'paper', connected: false },
        });
        if (data.identity) setIdentity(data.identity);
      }
      // If 401/empty — keep zeros (new user, no trades yet)
    } catch {
      // keep empty personal stats
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col pb-20">
      {/* Logo on every page */}
      <header className="border-b border-white/10 px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <Link href="/app" className="flex items-center gap-3 min-w-0">
            <Image
              src="/cletus-logo.png"
              alt="Cletus"
              width={40}
              height={40}
              className="object-contain shrink-0"
              priority
            />
            <div className="min-w-0">
              <div className="font-bold text-lg tracking-tight leading-none">Cletus</div>
              <div className="text-xs text-white/50 mt-0.5 truncate">
                Your performance
                {identity ? ` · ${identity.slice(0, 12)}` : ''}
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={load}
            className="text-xs text-white/40 hover:text-white font-mono"
          >
            {loading ? '…' : '↻'}
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <HeaderCard />
          <CollectivePnlTicker showCommunityLink />
          <TradingNetworks />
          {/* Trial strip */}
          {stats.trialActive && (
            <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#D4AF37]/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#E5C76B] uppercase tracking-wider">
                  Free trial active
                </div>
                <p className="text-sm text-white/70 mt-0.5">
                  {stats.daysRemaining} days left in your 30-day beta trial · paper trading, no payment
                </p>
              </div>
              <Link
                href="/tax"
                className="shrink-0 px-5 py-2.5 rounded-full text-sm font-semibold bg-[#D4AF37] text-black text-center hover:bg-[#E5C76B] transition-colors"
              >
                Tax center
              </Link>
            </div>
          )}

          <ConnectWallet
            mode="settings"
            currentPublicKey={stats.wallet?.address ?? null}
            source={stats.wallet?.source ?? 'paper'}
            onConnected={() => load()}
            onDisconnected={() => load()}
            onPaper={() => load()}
          />

          <ApprovalQueue approvals={stats.approvals ?? []} onChange={load} />

          <LivePortfolio
            equity={stats.equity ?? 0}
            cash={stats.cash}
            startingBalance={stats.startingBalance || 0}
            realizedPnl={stats.realizedPnl ?? 0}
            unrealizedPnl={stats.unrealized ?? 0}
            totalPnl={stats.totalPnl ?? 0}
            winRate={stats.winRateKnown ? stats.winRate / 100 : null}
            closedTrades={stats.totalTrades}
            open={stats.open ?? []}
            closed={stats.closed ?? []}
            operatorFeeBps={stats.operatorFeeBps}
          />

          {/* 24H PERFORMANCE — personal only */}
          <section>
            <h2 className="text-[11px] text-white/40 uppercase tracking-wider font-medium mb-3">
              24h Performance
            </h2>
            <p className="text-xs text-white/30 mb-3">
              Stats for <strong className="text-white/50">your account only</strong> — gains and
              losses from your trades.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="24h PnL"
                value={formatUsd(stats.pnl24h)}
                sub={`${stats.pnl24hPercent >= 0 ? '+' : ''}${stats.pnl24hPercent.toFixed(1)}%`}
                positive={stats.pnl24h >= 0}
                icon="💰"
              />
              <StatCard
                label="Win Rate"
                value={stats.winRateKnown ? `${stats.winRate.toFixed(1)}%` : '—'}
                sub={`${stats.totalTrades} total trades`}
                positive={stats.winRate >= 50}
                icon="🎯"
              />
              <StatCard
                label="Active Positions"
                value={`${stats.activePositions} of ${stats.maxPositions ?? 0}`}
                sub="open positions"
                neutral
                icon="📊"
              />
              <StatCard
                label="Sharpe Ratio"
                value={stats.sharpeKnown ? stats.sharpeRatio.toFixed(2) : '—'}
                sub="risk-adjusted return"
                positive={stats.sharpeRatio >= 1}
                icon="⚡"
              />
            </div>
          </section>

          {/* Secondary — best / worst / total */}
          <section>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Best Trade"
                value={formatUsd(stats.bestTrade)}
                sub={stats.bestSymbol ?? undefined}
                positive={stats.bestTrade >= 0}
                icon="🚀"
              />
              <StatCard
                label="Worst Trade"
                value={formatUsd(stats.worstTrade)}
                sub={stats.worstSymbol ?? undefined}
                positive={stats.worstTrade >= 0}
                icon="📉"
              />
              <StatCard
                label="Total Trades"
                value={String(stats.totalTrades)}
                sub="all time"
                neutral
                icon="🔢"
              />
            </div>
          </section>

          {!loading && stats.totalTrades === 0 && (
            <div className="rounded-2xl border border-white/10 bg-[#121212] p-6 text-center text-sm text-white/45">
              No trades yet for your account. Numbers stay at zero until you trade — then this
              dashboard tracks <strong className="text-white/60">your</strong> PnL only.
            </div>
          )}

          {/* Quick links */}
          <section>
            <h2 className="text-[11px] text-white/40 uppercase tracking-wider font-medium mb-3">
              Quick actions
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { href: '/app/chart', label: 'Chart', icon: '📈' },
                { href: '/app/signals', label: 'Signals', icon: '⚡' },
                { href: '/app/ai', label: 'Cletus AI', icon: '🤖' },
                { href: '/app/wallet', label: 'Wallet', icon: '💼' },
                { href: '/app/community', label: 'Community', icon: '🪿' },
                { href: '/app/trade', label: 'Simulate', icon: '▶️' },
                { href: '/app/dev-wallet', label: 'Dev Wallet', icon: '🔎' },
                { href: '/app/staking', label: 'Staking (soon)', icon: '🪙' },
                { href: '/', label: 'Engine console', icon: '🛠️' },
              ].map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="rounded-2xl border border-white/10 bg-[#121212] p-4 text-left hover:border-white/25 transition-colors"
                >
                  <div className="text-xl mb-1">{a.icon}</div>
                  <div className="text-sm font-semibold">{a.label}</div>
                </Link>
              ))}
            </div>
          </section>

          <p className="text-[11px] text-white/25 text-center leading-relaxed">
            Personal performance only. Past results do not guarantee future outcomes. Not
            financial advice. Trading involves risk of loss.
          </p>
        </div>
      </main>

      {/* Mobile-style bottom nav (like the screenshot) */}
    </div>
  );
}
