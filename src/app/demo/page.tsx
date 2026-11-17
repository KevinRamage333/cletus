import { isDemo } from '@/lib/demo';
import TradingNetworks from '@/components/TradingNetworks';
import Link from 'next/link';
import PublicLiveFeed from '@/components/PublicLiveFeed';
export const metadata = { title: 'Cletus, the golden goose (demo)' };
function GuestOverview() {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h1 className="text-4xl font-extrabold gold-text">Explore Cletus</h1>
        <p className="max-w-2xl text-zinc-300">Cletus is a Solana market-intelligence and paper-trading platform. You can review recorded results and the project whitepaper without an account.</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/live" className="font-semibold text-amber-300">Recorded performance</Link>
          <Link href="/live/paper" className="font-semibold text-amber-300">Paper trading report</Link>
          <Link href="/whitepaper" className="font-semibold text-amber-300">Whitepaper</Link>
          <Link href="/signup" className="font-semibold text-amber-300">Open an account</Link>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold">What Cletus supports</h2>
        <ul className="list-disc space-y-2 pl-5 text-zinc-300">
          <li>Solana token discovery, charts, and token risk checks.</li>
          <li>Paper trading with simulated entries and exits. Results depend on the data, fees, and execution assumptions.</li>
          <li>Read-only EVM charts and native-coin balances on supported networks. Multi-network trade execution is planned.</li>
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Historical strategy replay</h2>
        <p className="max-w-2xl text-zinc-300">A November 2026 walk-forward replay covered 60 Solana pools over 3.6 days. The tuned configuration had 34 out-of-sample trades, a 38.2% win rate, and −1.60% average P&amp;L per trade. The baseline averaged −1.29% over 20 trades. These are simulated results from a small sample. The replay used an OHLCV proxy for buy pressure.</p>
      </section>
    </div>
  );
}

export default function DemoHome({ searchParams }: { searchParams: { soon?: string } }) {
  if (!isDemo()) return <GuestOverview />;
  const soon = searchParams?.soon;
  return (
    <div className="space-y-8">
      {soon && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <strong>{soon}</strong> is coming online soon. Accounts, the dashboard and paper trading aren&apos;t available in this public demo yet.
        </div>
      )}
      <section className="grid md:grid-cols-2 gap-8 items-center">
        <div>
          <h1 className="text-4xl md:text-5xl font-extrabold leading-tight">Cletus,<br /><span className="gold-text">the golden goose.</span></h1>
          <p className="text-zinc-300 mt-4">An autonomous, self-learning, self-healing trading system for Solana tokens. He scans the market, audits every token, sizes every trade, and learns from each result. You can talk to his Brain, and he keeps up with world events.</p>
          <div className="flex flex-wrap gap-2 mt-4 text-xs">
            {['Solana', 'Helius', 'Jupiter', 'DexScreener', 'GeckoTerminal', 'RugCheck', 'Gemini by Google', 'Next.js'].map((s) => <span key={s} className="px-2 py-1 rounded-full border border-zinc-700 text-zinc-300">{s}</span>)}
          </div>
          <div className="flex flex-wrap gap-3 mt-6">
            <Link href="/demo/chart" className="px-4 py-2 rounded-lg bg-amber-400 text-black font-semibold no-underline">Live charts</Link>
            <Link href="/demo/community" className="px-4 py-2 rounded-lg border border-amber-400 text-amber-300 font-semibold no-underline">Community</Link>
            <Link href="/demo/brain" className="px-4 py-2 rounded-lg border border-amber-400 text-amber-300 font-semibold no-underline">Ask Cletus</Link>
            <Link href="/demo/wallet" className="px-4 py-2 rounded-lg border border-amber-400 text-amber-300 font-semibold no-underline">Wallet preview</Link>
            <Link href="/live/paper" className="px-4 py-2 rounded-lg border border-amber-400 text-amber-300 font-semibold no-underline">Recorded paper results</Link>
            <Link href="/whitepaper" className="px-4 py-2 rounded-lg border border-amber-400 text-amber-300 font-semibold no-underline">Whitepaper</Link>
          </div>
        </div>
        <img src="/cletus-hero.jpg" alt="Cletus the golden goose" className="w-full rounded-2xl border border-amber-500/30" />
      </section>
      <PublicLiveFeed compact />
      <section className="grid md:grid-cols-3 gap-4">
        {[
          ['Scanner + 8 signals', 'Volume spikes, breakouts, buy pressure, momentum, velocity, liquidity build, cap heat and vol/mcap, combined into one score.'],
          ['Audit before every trade', 'RugCheck report, mint/freeze authority, holder concentration and liquidity checks, plus a compliance gate.'],
          ['Risk first', 'Stop-loss and take-profit, a daily max loss with auto-pause, position caps, and a kill switch. The beta is simulation-only.'],
        ].map(([t, b]) => (
          <div key={t} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><h3 className="text-amber-300 font-semibold">{t}</h3><p className="text-sm text-zinc-400 mt-2">{b}</p></div>
        ))}
      </section>
      <section className="rounded-xl border border-amber-500/30 bg-zinc-950 p-5">
        <h2 className="text-xl font-bold gold-text">Accounts: coming online soon</h2>
        <p className="text-sm text-zinc-400 mt-2">Sign-up stays closed in this public demo. You can preview the optional wallet connection (you stay in control — Cletus never holds keys) and the recorded paper report when its data source is available. Private beta accounts will open here later. Until then, this site collects no personal data.</p>
        <p className="text-sm text-zinc-400 mt-2">Owner withdrawals from the trading wallet: <span className="text-amber-300">available when the trading worker is online</span>.</p>
        <TradingNetworks demo />
        <p className="text-sm text-zinc-400 mt-2">Read the <Link href="/whitepaper" className="text-amber-300">whitepaper and roadmap</Link>, the <Link href="/demo/disclaimer" className="text-amber-300">Terms and Risk Disclaimer</Link>, and the <Link href="/legal" className="text-amber-300">legal notice</Link>.</p>
      </section>
    </div>
  );
}
