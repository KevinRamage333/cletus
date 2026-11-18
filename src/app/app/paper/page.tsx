'use client';
import { TokenListingTags } from '@/components/listings/Listings';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { PageHeader, Refreshed, StateBox, Stat, TokenAvatar } from '@/components/app/ui';
import { useLocalPaper, useQuotes } from '@/components/app/usePaper';
import { useMovers } from '@/components/market/useMovers';
import { paperBuy, paperSell, valueAccount, PAPER_FEE_RATE } from '@/lib/local-paper';
import { formatPct, formatPrice, formatUsdCompact, sortMovers } from '@/lib/movers';
import { BASE58_MINT } from '@/lib/public-audit';

const usd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const tone = (n: number | null | undefined) => (n == null ? 'muted' : n >= 0 ? 'up' : 'down') as 'up' | 'down' | 'muted';

function PaperDesk() {
  const sp = useSearchParams();
  const { account, save, reset, corrupt } = useLocalPaper();
  const { data: board } = useMovers(30_000);
  const [mint, setMint] = useState('');
  const [amount, setAmount] = useState('100');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { const m = sp?.get('mint'); if (m && BASE58_MINT.test(m)) setMint(m); }, [sp]);
  const mints = useMemo(() => [...new Set([...(account?.positions.map((p) => p.mint) ?? []), ...(BASE58_MINT.test(mint) ? [mint] : [])])], [account, mint]);
  const { quotes, fetchedAt, error: qErr, loading } = useQuotes(mints, 10_000);
  const prices = useMemo(() => Object.fromEntries(Object.values(quotes).map((q) => [q.mint, q.priceUsd])), [quotes]);
  const val = account ? valueAccount(account, prices) : null;
  const sel = quotes[mint];
  const picks = useMemo(() => sortMovers(board?.tokens ?? [], 'volume').slice(0, 12), [board]);

  if (!account) return <div className="skeleton h-64" />;
  const buy = () => {
    if (!sel) { setMsg({ ok: false, text: 'No live quote for that token yet.' }); return; }
    const r = paperBuy(account, { mint: sel.mint, symbol: sel.symbol, name: sel.name, imageUrl: sel.imageUrl, priceUsd: sel.priceUsd, liquidityUsd: sel.liquidityUsd }, Number(amount));
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    save(r.account); setMsg({ ok: true, text: `Simulated buy: ${r.trade.tokens.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${sel.symbol} at ${formatPrice(r.trade.fillPriceUsd)} (fee ${usd(r.trade.feeUsd)}).` });
  };
  const sell = (m: string, f: number) => {
    const qt = quotes[m]; const pos = account.positions.find((p) => p.mint === m);
    if (!qt || !pos) { setMsg({ ok: false, text: 'No live quote for that token right now; cannot simulate a sale.' }); return; }
    const r = paperSell(account, { mint: m, symbol: pos.symbol, priceUsd: qt.priceUsd, liquidityUsd: qt.liquidityUsd }, f);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    save(r.account); setMsg({ ok: true, text: `Simulated sell: ${pos.symbol} for ${usd(r.trade.notionalUsd)}, realized ${usd(r.trade.realizedPnlUsd)}.` });
  };

  return (
    <div>
      <div className="mb-5 border border-[#e3c06a]/50 bg-[#e3c06a]/10 px-4 py-2.5 text-xs font-semibold text-[#f3dc95]" data-testid="paper-banner">PAPER TRADING · simulated with real prices · no real funds · live trading is disabled</div>
      <PageHeader eyebrow="Practice desk" title="Paper trading" actions={<><Refreshed at={fetchedAt} stale={!!qErr} label="Prices" /><button className="btn-line !py-2" onClick={() => { if (confirm('Reset the practice account to $10,000? This clears local paper history.')) reset(); }}>Reset</button></>}>
        Your practice account lives in this browser. Fills include a {PAPER_FEE_RATE * 100}% fee and pool price impact, using the same model as the Cletus engine.
      </PageHeader>
      {corrupt && <div className="mb-4"><StateBox kind="error" title="Saved practice data was unreadable">A fresh account was loaded. Reset to overwrite the old data.</StateBox></div>}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Equity" value={usd(val?.equityUsd)} sub={val?.unpricedMints.length ? 'Some prices unavailable' : `Started ${usd(account.startingUsd)}`} testId="paper-equity" />
        <Stat label="Cash" value={usd(account.cashUsd)} />
        <Stat label="Unrealized P&L" value={usd(val?.unrealizedPnlUsd)} tone={tone(val?.unrealizedPnlUsd)} />
        <Stat label="Realized P&L" value={usd(val?.realizedPnlUsd)} tone={tone(val?.realizedPnlUsd)} testId="paper-realized" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[.9fr_1.1fr]">
        <section className="panel panel-hi min-w-0 p-5">
          <h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Simulated order</h3>
          <label htmlFor="mint" className="mt-4 block text-xs text-[#8a8478]">Token mint</label>
          <input id="mint" className="field num mt-1 text-xs" placeholder="Paste a Solana mint or pick below" value={mint} onChange={(e) => setMint(e.target.value.trim())} />
          {mint && !BASE58_MINT.test(mint) && <p className="mt-1 text-xs text-red-300">That is not a valid Solana mint address.</p>}
          <div className="mt-3 flex flex-wrap gap-1.5">{picks.map((t) => <button key={t.mint} onClick={() => setMint(t.mint)} className={`border px-2 py-1 text-[11px] font-semibold ${t.mint === mint ? 'border-[#d4af37] text-[#f3dc95]' : 'border-white/10 text-[#a39c8f]'}`}>{t.symbol}</button>)}</div>
          <div className="mt-4 min-h-[64px]" data-testid="paper-quote">
            {!mint ? <StateBox kind="empty" title="Pick a token to see a live quote" /> : sel ? (
              <div className="flex items-center gap-3"><TokenAvatar src={sel.imageUrl} symbol={sel.symbol} /><div><p className="font-bold text-[#f6f1e4]">{sel.name} <span className="text-[#c9a24a]">${sel.symbol}</span></p><TokenListingTags mint={sel.mint} /><p className="num text-xs text-[#a39c8f]">{formatPrice(sel.priceUsd)} · mcap {formatUsdCompact(sel.marketCapUsd)} · liq {formatUsdCompact(sel.liquidityUsd)} · 1h {formatPct(sel.change1hPct)}</p></div></div>
            ) : loading ? <div className="skeleton h-12" /> : <StateBox kind={qErr ? 'error' : 'empty'} title={qErr ? 'Quote unavailable' : 'No DexScreener pool found for this mint'}>{qErr}</StateBox>}
          </div>
          <label htmlFor="amount" className="mt-4 block text-xs text-[#8a8478]">Amount (paper USD)</label>
          <div className="mt-1 flex gap-2"><input id="amount" inputMode="decimal" className="field num" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />{[50, 250, 1000].map((v) => <button key={v} className="btn-line !px-3 !py-2" onClick={() => setAmount(String(v))}>${v}</button>)}</div>
          <button className="btn-gold mt-4 w-full" onClick={buy} disabled={!sel?.priceUsd} data-testid="paper-buy">Simulate buy</button>
          {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-green-300' : 'text-red-300'}`} data-testid="paper-msg">{msg.text}</p>}
        </section>

        <section className="min-w-0">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Open positions</h3>
          {account.positions.length === 0 ? <StateBox kind="empty" title="No open paper positions">Simulate a buy to start practicing.</StateBox> : (
            <ul className="space-y-2" data-testid="paper-positions">
              {account.positions.map((p) => { const qt = quotes[p.mint]; const value = qt?.priceUsd ? p.tokens * qt.priceUsd : null; const pnl = value == null ? null : value - p.costUsd; return (
                <li key={p.mint} className="panel flex flex-wrap items-center gap-3 p-3">
                  <TokenAvatar src={p.imageUrl} symbol={p.symbol} size={36} />
                  <div className="min-w-0 flex-1"><p className="font-semibold text-[#f6f1e4]">{p.symbol}</p><p className="num text-xs text-[#8a8478]">cost {usd(p.costUsd)} · value {value == null ? 'price unavailable' : usd(value)}</p></div>
                  <p className={`num text-sm font-bold ${pnl == null ? 'text-[#8a8478]' : pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{usd(pnl)}{pnl != null && ` (${formatPct((pnl / p.costUsd) * 100)})`}</p>
                  <div className="flex w-full justify-end gap-1 sm:w-auto">{[0.25, 0.5, 1].map((f) => <button key={f} className="btn-line !px-2 !py-1 !text-[10px]" onClick={() => sell(p.mint, f)} disabled={!qt?.priceUsd} data-testid={f === 1 ? 'paper-sell-all' : undefined}>Sell {f * 100}%</button>)}</div>
                </li>); })}
            </ul>
          )}
          <h3 className="mb-3 mt-6 text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Recent simulated trades</h3>
          {account.trades.length === 0 ? <StateBox kind="empty" title="No trades yet" /> : (
            <div className="overflow-x-auto"><table className="num w-full min-w-[480px] text-left text-xs"><thead><tr className="text-[#8a8478]"><th className="py-1">Time</th><th>Side</th><th>Token</th><th>Fill</th><th>USD</th><th>Realized</th></tr></thead>
              <tbody>{[...account.trades].reverse().slice(0, 15).map((t) => <tr key={t.id} className="border-t border-white/5"><td className="py-1.5">{new Date(t.at).toLocaleTimeString()}</td><td className={t.side === 'buy' ? 'text-green-300' : 'text-red-300'}>{t.side.toUpperCase()}</td><td>{t.symbol}</td><td>{formatPrice(t.fillPriceUsd)}</td><td>{usd(t.notionalUsd)}</td><td>{t.realizedPnlUsd == null ? '—' : usd(t.realizedPnlUsd)}</td></tr>)}</tbody></table></div>
          )}
          <p className="mt-4 text-xs text-[#8a8478]">Signed-in members can also run the server-side engine simulator with the full strategy and safety gates: <Link href="/app/trade" className="text-[#c9a24a] underline">Engine Simulator</Link>. Results recorded by the engine: <Link href="/live/paper" className="text-[#c9a24a] underline">paper performance</Link>.</p>
        </section>
      </div>
    </div>
  );
}

export default function PaperPage() {
  return <Suspense fallback={<div className="skeleton h-64" />}><PaperDesk /></Suspense>;
}
