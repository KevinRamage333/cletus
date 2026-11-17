import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser, onboardingStep } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Restricted operations overview. Never expose account-level user P&L or wallet secrets. */
export default async function AdminOperationsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (onboardingStep(user) !== 'done') redirect('/app');
  if (!user.isAdmin) redirect('/app');

  const [users, accounts, openPaper, closedPaper, engine] = await Promise.all([
    prisma.user.count(),
    prisma.account.count(),
    prisma.position.count({ where: { status: 'open', simulated: true } }),
    prisma.position.count({ where: { status: 'closed', simulated: true } }),
    prisma.engineState.findUnique({ where: { id: 'global' }, select: { killSwitch: true, pausedUntil: true, lastScanAt: true, scanCount: true } }).catch(() => null),
  ]);
  const stopped = !engine || engine.killSwitch || Boolean(engine.pausedUntil && engine.pausedUntil > new Date());
  const cards = [
    { label: 'Registered users', value: users.toLocaleString() },
    { label: 'Paper accounts & operators', value: accounts.toLocaleString() },
    { label: 'Open paper positions', value: openPaper.toLocaleString() },
    { label: 'Closed paper positions', value: closedPaper.toLocaleString() },
    { label: 'Recorded scans', value: engine?.scanCount.toLocaleString() ?? 'Unavailable' },
    { label: 'Engine entry status', value: stopped ? 'Held / unavailable' : 'Enabled by engine state' },
  ];
  return <main className="min-h-screen bg-black px-4 py-8 text-white">
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2"><Link href="/app" className="text-sm text-[#E5C76B]">← Command Center</Link>
        <h1 className="text-3xl font-bold text-[#E5C76B]">Operations Desk</h1>
        <p className="text-sm text-white/50">Admin-only read-only system overview. Trading remains subject to the engine kill switch and risk gates.</p>
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{cards.map(card => <div key={card.label} className="rounded-xl border border-[#D4AF37]/20 bg-[#121212] p-4"><div className="text-xs text-white/50">{card.label}</div><div className="mt-2 text-xl font-semibold">{card.value}</div></div>)}</div>
      <section className="rounded-xl border border-white/10 bg-[#121212] p-4 space-y-2"><h2 className="font-semibold">Scanner heartbeat</h2><p className="text-sm text-white/60">Last recorded scan: {engine?.lastScanAt ? engine.lastScanAt.toISOString() : 'Unavailable'}</p><p className="text-xs text-white/40">These counters are database snapshots, not proof of a currently running worker or successful live trading.</p></section>
      <nav className="flex flex-wrap gap-3 text-sm"><Link className="text-[#E5C76B] underline" href="/app/discover">Discovery</Link><Link className="text-[#E5C76B] underline" href="/app/community">Community</Link><Link className="text-[#E5C76B] underline" href="/app/config">Risk settings</Link><Link className="text-[#E5C76B] underline" href="/app/operations/strategy-analytics">Verified strategy analytics</Link></nav>
    </div>
  </main>;
}
