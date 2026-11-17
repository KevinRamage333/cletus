'use client';
import { useMemo } from 'react';
import { PageHeader, StateBox, Stat } from '@/components/app/ui';
import { useLocalPaper } from '@/components/app/usePaper';
import { lotsToCsv, realizedLots } from '@/lib/local-paper';

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function LocalTax() {
  const { account } = useLocalPaper();
  const lots = useMemo(() => (account ? realizedLots(account) : []), [account]);
  const totals = lots.reduce((t, l) => ({ proceeds: t.proceeds + l.proceedsUsd, basis: t.basis + l.costBasisUsd, gain: t.gain + l.gainUsd }), { proceeds: 0, basis: 0, gain: 0 });
  const download = () => {
    const blob = new Blob([lotsToCsv(lots)], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cletus-paper-realized-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div>
      <PageHeader eyebrow="Tax & reporting" title="Realized gains and losses" actions={<button className="btn-gold" onClick={download} disabled={!lots.length} data-testid="tax-export">Export CSV</button>}>
        A Form 8949-style view of your realized paper trades. Paper trades are simulated and are not taxable events. Not tax advice; consult a qualified professional.
      </PageHeader>
      <div className="mb-5"><StateBox kind="info" title="Simulated records">Practice trades from this browser only. Real on-chain activity from connected wallets is not imported yet.</StateBox></div>
      {!account ? <div className="skeleton h-32" /> : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <Stat label="Proceeds" value={lots.length ? usd(totals.proceeds) : '—'} tone={lots.length ? undefined : 'muted'} />
            <Stat label="Cost basis" value={lots.length ? usd(totals.basis) : '—'} tone={lots.length ? undefined : 'muted'} />
            <Stat label="Net gain/loss" value={lots.length ? usd(totals.gain) : '—'} tone={!lots.length ? 'muted' : totals.gain >= 0 ? 'up' : 'down'} testId="tax-net" />
          </div>
          {lots.length === 0 ? <StateBox kind="empty" title="No realized trades yet">Close a position on the Paper Trading desk and it will appear here.</StateBox> : (
            <div className="overflow-x-auto"><table className="num w-full min-w-[640px] text-left text-xs" data-testid="tax-table">
              <thead><tr className="border-b border-[rgba(212,175,55,.25)] text-[10px] uppercase tracking-[.14em] text-[#c9a24a]"><th className="py-2">Sold</th><th>Asset</th><th>Acquired</th><th>Proceeds</th><th>Cost basis</th><th>Gain/loss</th><th>Term</th></tr></thead>
              <tbody>{[...lots].reverse().map((l, i) => <tr key={i} className="border-b border-white/5"><td className="py-2">{new Date(l.date).toLocaleString()}</td><td>{l.symbol}</td><td>{l.acquired ? new Date(l.acquired).toLocaleDateString() : '—'}</td><td>{usd(l.proceedsUsd)}</td><td>{usd(l.costBasisUsd)}</td><td className={l.gainUsd >= 0 ? 'text-emerald-300' : 'text-red-300'}>{usd(l.gainUsd)}</td><td>{l.term}</td></tr>)}</tbody>
            </table></div>
          )}
        </>
      )}
    </div>
  );
}
