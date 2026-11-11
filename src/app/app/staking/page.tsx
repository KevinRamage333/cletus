/**
 * Staking: informational "Coming soon" page only. No staking, token purchase, or wallet actions exist in this build.
 * Route: /app/staking
 */
import Link from 'next/link';

export const metadata = { title: 'Cletus · Staking (coming soon)' };

export default function StakingPage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col pb-20">
      <header className="border-b border-white/10 px-4 sm:px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-2.5">
          <img src="/cletus-logo.png" alt="Cletus" width={36} height={36} className="rounded-full" />
          <div><div className="font-bold text-lg leading-none gold-text">Cletus</div><div className="text-xs text-white/50 mt-0.5">Staking</div></div>
        </div>
      </header>
      <main className="flex-1 px-4 sm:px-6 py-10">
        <div className="max-w-2xl mx-auto space-y-5 text-center">
          <img src="/cletus-avatar.png" alt="" width={96} height={96} className="mx-auto rounded-full ring-2 ring-emerald-500/60" />
          <h1 className="text-3xl font-bold tracking-tight gold-text">Coming soon</h1>
          <p className="text-sm text-white/60 leading-relaxed">
            Staking is not available. There is no token, no staking contract, and nothing to buy or deposit in this app.
            This page is a placeholder for a possible future feature, which would only ship after a legal and regulatory review.
          </p>
          <div className="rounded-2xl border border-emerald-500/20 bg-[#121212] p-5 text-left space-y-2 text-sm text-white/70">
            <div className="text-xs font-semibold uppercase tracking-wider text-white/40">What this means today</div>
            <p>• Every Cletus feature in the beta is free during your 30-day trial, with no stake required.</p>
            <p>• Nobody from Cletus will ever ask you to send funds to &quot;stake&quot;, &quot;unlock&quot;, or &quot;verify&quot;. Treat any such message as a scam.</p>
            <p>• Nothing here is an offer of securities, investment returns, or profit sharing.</p>
          </div>
          <Link href="/app" className="inline-block px-5 py-2.5 rounded-full text-sm font-semibold bg-emerald-500 text-black">Back to dashboard</Link>
        </div>
      </main>
    </div>
  );
}
