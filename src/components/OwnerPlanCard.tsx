'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
const usd = (n: number | null | undefined, d = 2) =>
  (n === null || n === undefined ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const short = (a: string | null | undefined) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : (a ?? '—'));

/** Owner-only card: equity sizing tier, trade size, sweep ladder, total paid out. */
export default function OwnerPlanCard({ plan }: { plan: any }) {
  if (!plan || !plan.enabled) return null;
  const next = plan.nextSweepTargetUsd;
  const progress = plan.equityUsd !== null && next > 0 && plan.currentBaseUsd >= 0 ? Math.max(0, Math.min(100, ((plan.equityUsd - plan.currentBaseUsd) / Math.max(1, next - plan.currentBaseUsd)) * 100)) : 0;
  return (
    <div className="card">
      <h2>Owner money plan</h2>
      <div className="scorecard">
        <div>
          <div className="k">Current tier</div>
          <div className="v2">{usd(plan.tradeSizeUsd, 0)} / trade</div>
          <div className="k">from ${Number(plan.currentTier?.minEquityUsd ?? 0).toFixed(0)} equity · reserve {plan.feeReserveSol} SOL</div>
        </div>
        <div>
          <div className="k">Next sweep target</div>
          <div className="v2">{usd(next, 0)}</div>
          <div className="k">base {usd(plan.currentBaseUsd, 0)} · sends $25 when flat</div>
        </div>
        <div>
          <div className="k">Total paid out</div>
          <div className="v2">{usd(plan.totalPaidUsd)}</div>
          <div className="k">today {usd(plan.paidTodayUsd)}</div>
        </div>
        <div>
          <div className="k">Rules</div>
          <div className="v2" style={{ fontSize: 16 }}>{plan.maxOpenPositions} pos · {plan.stopLossPct}/{plan.takeProfitPct}%</div>
          <div className="k">{plan.mcapPreset} band</div>
        </div>
      </div>
      <div className="bar" style={{ marginTop: 10 }} title={`${progress.toFixed(0)}% of the way from base to the next sweep`}>
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        {plan.sweepArmed
          ? (plan.sweepPausedReason ?? `Sweep armed to ${short(plan.payoutWallet)}.`)
          : (plan.sweepPausedReason ?? 'Profit sweep is not armed.')}
        {' '}Trading wallet {short(plan.tradingWallet)}.
      </div>
      {Array.isArray(plan.payouts) && plan.payouts.length > 0 && (
        <div className="scroll" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th>Rung</th><th>Amount</th><th>Status</th><th>Tx</th></tr></thead>
            <tbody>
              {plan.payouts.slice(0, 8).map((p: any) => (
                <tr key={p.rungKey + p.at}>
                  <td>{p.rungKey}</td>
                  <td>{usd(p.amountUsd)}</td>
                  <td>{p.status}</td>
                  <td className="mono">{p.signature ? <a href={`https://solscan.io/tx/${p.signature}`} target="_blank" rel="noreferrer">{short(p.signature)}</a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
