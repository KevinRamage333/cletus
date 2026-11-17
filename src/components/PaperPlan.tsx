'use client';

import { useId, useState } from 'react';
import { calculatePaperPlan } from '@/lib/paper-plan';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const price = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumSignificantDigits: 6,
});
const quantity = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 });
const decimal = (value: string) => value.trim() === '' ? NaN : Number(value);

export default function PaperPlan({ symbol, referencePrice }: { symbol: string; referencePrice: number }) {
  const id = useId();
  const validReference = Number.isFinite(referencePrice) && referencePrice > 0;
  const [entry, setEntry] = useState(validReference ? String(referencePrice) : '');
  const [size, setSize] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [costs, setCosts] = useState('');
  const fields = [
    { name: 'Entry price (USD)', value: entry, set: setEntry },
    { name: 'Position size (USD)', value: size, set: setSize },
    { name: 'Stop below entry (%)', value: stop, set: setStop },
    { name: 'Target above entry (%)', value: target, set: setTarget },
    { name: 'Round-trip costs (USD)', value: costs, set: setCosts },
  ];
  const plan = calculatePaperPlan({
    entry: decimal(entry), sizeUsd: decimal(size), stopPct: decimal(stop),
    targetPct: decimal(target), costsUsd: decimal(costs),
  });

  return (
    <section aria-labelledby={id} className="space-y-3 rounded-xl border border-white/10 bg-[#101010] p-4">
      <h2 id={id} className="font-bold">Paper setup · {symbol}</h2>
      <p className="text-xs text-white/55">
        Estimate a long trade. Include estimated fees and slippage in round-trip costs. This preview places no orders.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {fields.map(field => (
          <label key={field.name} className="min-w-0 text-xs text-white/70">
            {field.name}
            <input type="number" min="0" step="any" inputMode="decimal" value={field.value}
              onChange={event => field.set(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black px-2 py-2 font-mono text-white" />
          </label>
        ))}
      </div>
      {plan ? (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {[
              ['Modeled token quantity', quantity.format(plan.tokens)],
              ['Stop price', price.format(plan.stopPrice)],
              ['Target price', price.format(plan.targetPrice)],
              ['Modeled loss at stop', usd.format(plan.lossAtStop)],
              ['Net P&L at target', usd.format(plan.pnlAtTarget)],
              ['Net reward / risk', plan.ratio === null ? '—' : quantity.format(plan.ratio) + '×'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-white/55">{label}</dt>
                <dd className="font-mono">{value}</dd>
              </div>
            ))}
          </dl>
          {plan.pnlAtTarget <= 0 && <p className="text-xs text-amber-300">At this target, gross gains do not exceed estimated costs.</p>}
        </>
      ) : (
        <p className="text-xs text-white/55">Enter positive entry, size, stop and target values. Stop must be below 100%. Enter 0 if you want a cost-free scenario.</p>
      )}
      <p className="text-xs text-white/45">The estimate assumes fills at the prices shown. Price gaps and actual execution costs can change the outcome.</p>
    </section>
  );
}
