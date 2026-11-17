import Link from 'next/link';

/** One entry point to the existing Cletus workspaces. No second backend or wallet. */
const desks = [
  { href: '/app/discover', title: 'Token Discovery', detail: 'Scanned assets and token research', icon: '🚀' },
  { href: '/app/chart', title: 'Charts', detail: 'Market charts and price research', icon: '📈' },
  { href: '/app/trade', title: 'Paper Trading', detail: 'Simulation and trade controls', icon: '🧪' },
  { href: '/app/signals', title: 'Signals', detail: 'Scoring and strategy signals', icon: '⚡' },
  { href: '/app/community', title: 'Community', detail: 'Chat and collective paper P&L', icon: '💬' },
  { href: '/app/auditor', title: 'Cletus Auditor', detail: 'Coin grades, checks and verification status', icon: '🔎' },
  { href: '/app/dev-wallet', title: 'Dev Wallet Inspector', detail: 'Wallet holdings and activity', icon: '👁️' },
  { href: '/app/wallet', title: 'Wallets', detail: 'Connected wallet management', icon: '👛' },
  { href: '/app/base', title: 'Base Desk', detail: 'Base network workspace', icon: '🔵' },
  { href: '/app/ai', title: 'Cletus AI', detail: 'Assistant and analysis', icon: '🪿' },
  { href: '/app/config', title: 'Risk & Settings', detail: 'Trading preferences and safeguards', icon: '⚙️' },
] as const;

export default function UnifiedDashboardHub() {
  return (
    <section aria-labelledby="unified-dashboard-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="unified-dashboard-title" className="text-sm font-semibold text-[#E5C76B]">Cletus Command Center</h2>
        <span className="text-[11px] text-white/40">One app · one account</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {desks.map((desk) => (
          <Link key={desk.href} href={desk.href} className="group rounded-xl border border-[#D4AF37]/20 bg-[#121212] p-3 hover:border-[#D4AF37]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37] transition-colors">
            <div className="text-xl" aria-hidden="true">{desk.icon}</div>
            <div className="mt-2 text-sm font-semibold text-white group-hover:text-[#E5C76B]">{desk.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-white/50">{desk.detail}</p>
          </Link>
        ))}
      </div>
      <p className="text-xs text-white/40">Market data and network support vary by workspace. Paper trading does not guarantee live execution or profitability.</p>
    </section>
  );
}
