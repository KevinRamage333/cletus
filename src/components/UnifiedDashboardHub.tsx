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
    <section aria-labelledby="unified-dashboard-title" className="space-y-5 rounded-[28px] border border-[#b9944d]/35 bg-[#151518] p-5 shadow-[0_22px_65px_rgba(0,0,0,0.32)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-4"><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[19px] bg-gradient-to-br from-[#f1cd81] to-[#bd8e3f] text-3xl font-black text-[#161515] shadow-lg">C</div><div><p className="text-[11px] font-semibold uppercase tracking-[.25em] text-white/45">CLETUS · THE GOLDEN ONE</p>
        <h2 id="unified-dashboard-title" className="mt-1 text-xl font-bold tracking-tight text-white">Cletus Command Center</h2></div></div>
        <span className="rounded-full border border-[#d2a75b]/30 px-3 py-1.5 text-[11px] tracking-wide text-[#e6c27e]">ONE APP · ONE ACCOUNT</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {desks.map((desk) => (
          <Link key={desk.href} href={desk.href} className="group rounded-2xl border border-[#b9944d]/25 bg-[#101012] p-5 transition-all hover:-translate-y-0.5 hover:border-[#e0ba6c]/75 hover:bg-[#1c1a18] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]">
            <div className="text-2xl" aria-hidden="true">{desk.icon}</div>
            <div className="mt-4 text-base font-bold text-white group-hover:text-[#E5C76B]">{desk.title}</div>
            <p className="mt-2 text-sm leading-relaxed text-white/50">{desk.detail}</p>
          </Link>
        ))}
      </div>
      <p className="text-xs text-white/40">Market data and network support vary by workspace. Paper trading does not guarantee live execution or profitability.</p>
    </section>
  );
}
