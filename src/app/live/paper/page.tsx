import Link from 'next/link';
import { isDemo } from '@/lib/demo';
import { PUBLIC_PAPER_LIMIT, summarizePaperCloses } from '@/lib/public-paper-performance';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cletus paper trading report' };

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const date = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
});

async function loadReport() {
  if (isDemo() || !process.env.DATABASE_URL) return null;
  try {
    const { prisma } = await import('@/lib/db');
    const now = new Date();
    const since = new Date(now.getTime() - 2 * 60 * 60_000);
    const operatorPaper = { account: { isOperator: true }, simulated: true };
    const [closes, state, entries, closedInWindow] = await Promise.all([
      prisma.position.findMany({
      where: { ...operatorPaper, status: 'closed', closedAt: { not: null } },
      orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
      take: PUBLIC_PAPER_LIMIT + 1,
      select: { closedAt: true, network: true, symbol: true, pnlUsd: true, feesUsd: true },
      }),
      prisma.engineState.findUnique({ where: { id: 'global' }, select: { lastScanAt: true, killSwitch: true, pausedUntil: true } }),
      prisma.position.count({ where: { ...operatorPaper, openedAt: { gte: since, lte: now } } }),
      prisma.position.count({ where: { ...operatorPaper, status: 'closed', closedAt: { gte: since, lte: now } } }),
    ]);
    const lastScanAt = state?.lastScanAt ?? null;
    const scanAgeMs = lastScanAt ? now.getTime() - lastScanAt.getTime() : null;
    return {
      ...summarizePaperCloses(closes),
      lastScanAt, entries, closedInWindow,
      scanningRecently: !!state && !state.killSwitch && (!state.pausedUntil || state.pausedUntil <= now)
        && scanAgeMs !== null && scanAgeMs >= 0 && scanAgeMs <= 180_000,
    };
  } catch {
    console.error('[public-paper] Recorded paper closes unavailable');
    return null;
  }
}

export default async function PaperPerformancePage() {
  const report = await loadReport();
  const ledger = report?.ledger ?? [];
  const first = ledger[0];
  const last = ledger.at(-1);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <Link href="/live" className="text-sm text-amber-300">Recorded live book</Link>
      <header className="space-y-2">
        <h1 className="text-3xl font-extrabold gold-text">Paper trading performance</h1>
        <p className="text-sm text-zinc-300">Recorded simulated closes from Cletus’s operator account. The report covers up to {PUBLIC_PAPER_LIMIT} recent closed positions.</p>
      </header>
      {!report && <p role="status">Recorded paper results are currently unavailable.</p>}
      {report && (
        <section className="space-y-2 rounded-xl border border-white/10 p-4">
          <h2 className="font-semibold">Activity in the last two hours</h2>
          <p className="text-sm text-zinc-300">{report.entries} paper entries · {report.closedInWindow} paper closes</p>
          <p className="text-sm text-zinc-400">{report.scanningRecently ? 'Scanner recently active' : 'Scanner inactive, paused, or stale'} · Last recorded scan {report.lastScanAt ? date.format(report.lastScanAt) + ' UTC' : 'unavailable'}</p>
          {report.closedInWindow === 0 && <p className="text-sm text-amber-300">No new paper closes in this window. The results below are historical.</p>}
        </section>
      )}
      {report && !first && <p role="status">No eligible paper closes are available in this sample.</p>}
      {report && report.omitted > 0 && <p className="text-sm text-zinc-400">{report.omitted} sampled closes lacked usable P&amp;L or fee values and were excluded.</p>}
      {report && first && last && (
        <>
          <p className="text-sm text-zinc-400">{date.format(first.closedAt)} to {date.format(last.closedAt)} UTC · {ledger.length} closes{report.truncated ? ' · older records omitted' : ''}</p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Realized P&L', usd.format(report.cumulativePnlUsd)],
              ['Recorded fees', usd.format(report.feesUsd)],
              ['Max realized drawdown', usd.format(report.maxDrawdownUsd)],
              ['Win rate', report.winRate === null ? '—' : `${(report.winRate * 100).toFixed(1)}%`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/10 p-3">
                <dt className="text-sm text-zinc-400">{label}</dt>
                <dd className="mt-1 text-xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-zinc-300">{report.wins} wins · {report.losses} losses · {report.flat} flat. Win rate uses all eligible closes.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="mb-3 text-left font-semibold">Realized P&amp;L by close</caption>
              <thead>
                <tr className="border-b border-white/15">
                  {['Close (UTC)', 'Token', 'Network', 'Fees', 'Realized P&L', 'Cumulative P&L'].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {ledger.map((row, index) => (
                  <tr key={index} className="border-b border-white/10">
                    <td className="whitespace-nowrap p-2">{date.format(row.closedAt)}</td>
                    <td className="p-2">{row.symbol}</td><td className="p-2">{row.network}</td>
                    <td className="p-2">{usd.format(row.feesUsd)}</td>
                    <td className="p-2">{usd.format(row.pnlUsd)}</td>
                    <td className="p-2">{usd.format(row.cumulativePnlUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-sm text-zinc-400">Drawdown measures the largest decline from a prior peak in cumulative realized P&amp;L, starting at zero for this sample. Open positions and account equity are outside this report. Paper results do not predict live returns.</p>
    </main>
  );
}
