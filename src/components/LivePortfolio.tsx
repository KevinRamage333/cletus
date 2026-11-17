'use client';
import Link from 'next/link';
import { solscanAccountUrl, solscanTxUrl } from '@/lib/approvals';
import { moneyText, refreshedLabel } from '@/lib/figure';

function usd(n: number | null | undefined, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return { text: 'Unavailable', state: 'unavailable' as const };
  if (n === 0) return { text: d === 0 ? '$0' : '$0.00', state: 'zero' as const };
  return { text: moneyText(n).text, state: moneyText(n).state };
}
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const cls = (n: number | null | undefined) => (n === null || n === undefined ? '' : n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-white/70');

export type PortfolioPosition = {
  id: string; symbol: string; mint: string; sizeUsd: number; entryPrice: number; lastPrice: number;
  pnlUsd: number; pnlPct: number; feesUsd?: number; operatorFeeUsd?: number; operatorFeeBps?: number;
  openedAt: string; simulated?: boolean; entryTx?: string | null; solscanEntry?: string | null; solscanMint?: string | null;
};
export type PortfolioTrade = {
  id: string; symbol: string; mint: string; sizeUsd: number; entryPrice: number; exitPrice: number | null;
  pnlUsd: number | null; pnlPct: number | null; feesUsd?: number; operatorFeeUsd?: number; operatorFeeBps?: number;
  exitReason?: string | null; openedAt: string; closedAt: string | null; simulated?: boolean;
  entryTx?: string | null; exitTx?: string | null; solscanEntry?: string | null; solscanExit?: string | null; solscanMint?: string | null;
};

type Props = {
  equity: number | null;
  cash?: number | null;
  startingBalance: number | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  totalPnl: number | null;
  winRate: number | null;
  closedTrades: number | null;
  open: PortfolioPosition[];
  closed: PortfolioTrade[];
  operatorFeeBps?: number;
  demo?: boolean;
  refreshedAt?: string | null;
};

function SolscanLink({ href, label }: { href?: string | null; label: string }) {
  if (!href) return <span className="text-white/30">{label}</span>;
  return <a href={href} target="_blank" rel="noreferrer" className="text-amber-300 hover:underline">{label}</a>;
}

export default function LivePortfolio(p: Props) {
  const bps = p.operatorFeeBps ?? 50;
  return (
    <div className="space-y-6" data-testid="live-portfolio">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Equity', usd(p.equity), `start ${usd(p.startingBalance, 0).text}`],
          ['Total P&L', usd(p.totalPnl), `realized ${usd(p.realizedPnl).text} · open ${usd(p.unrealizedPnl).text}`],
          ['Win rate', { text: p.winRate == null ? 'Unavailable' : `${(p.winRate * (p.winRate <= 1 ? 100 : 1)).toFixed(0)}%`, state: p.winRate == null ? 'unavailable' as const : 'value' as const }, `${p.closedTrades ?? 'Unavailable'} closed trades`],
          ['Open positions', { text: String(p.open.length), state: 'value' as const }, p.cash != null ? `cash ${usd(p.cash).text}` : ''],
        ].map(([l, v, s]) => {
          const figure = v as { text: string; state: string };
          return (
          <div key={l as string} className="rounded-2xl border border-white/10 bg-[#121212] p-4">
            <div className="text-[11px] text-white/40 uppercase tracking-wider">{l as string}</div>
            <div data-figure={figure.state} className={`text-xl font-bold font-mono mt-1 ${figure.state === 'unavailable' ? 'text-white/35 italic' : l === 'Total P&L' ? cls(p.totalPnl) : 'text-white'}`}>{figure.text}</div>
            <div className="text-xs text-white/40 mt-0.5">{s as string}</div>
          </div>
          );
        })}
      </section>
      <p className="text-[11px] text-white/40" data-testid="portfolio-refreshed-at">{refreshedLabel('Portfolio P&L', p.refreshedAt ?? null)}</p>
      <p className="text-[11px] text-white/40">Each swap includes a { (bps / 100).toFixed(1) }% ({bps} bps) Cletus platform fee, collected via Jupiter. Jupiter keeps 20% of that fee. Network fees and slippage are separate. Not financial advice; paper results do not predict live results.</p>

      <section className="rounded-2xl border border-white/10 bg-[#121212] p-4 overflow-x-auto">
        <h2 className="text-sm font-semibold mb-3">Open positions</h2>
        {p.open.length === 0 ? <p className="text-sm text-white/40">No open positions.</p> : (
          <table className="w-full text-sm">
            <thead className="text-[11px] text-white/40 uppercase tracking-wider">
              <tr><th className="text-left py-2">Token</th><th className="text-right">Size</th><th className="text-right">Entry</th><th className="text-right">Last</th><th className="text-right">P&L</th><th className="text-right">0.5% fee</th><th className="text-right">On-chain</th></tr>
            </thead>
            <tbody>
              {p.open.map((r) => (
                <tr key={r.id} className="border-t border-white/10">
                  <td className="py-2 font-semibold">{r.symbol}{r.simulated ? <span className="ml-1 text-[10px] text-white/35">paper</span> : null}</td>
                  <td className="text-right font-mono">{usd(r.sizeUsd).text}</td>
                  <td className="text-right font-mono">{r.entryPrice.toPrecision(4)}</td>
                  <td className="text-right font-mono">{r.lastPrice.toPrecision(4)}</td>
                  <td className={`text-right font-mono ${cls(r.pnlUsd)}`}>{usd(r.pnlUsd).text} <span className="text-xs">{pct(r.pnlPct)}</span></td>
                  <td className="text-right font-mono text-amber-300">{usd(r.operatorFeeUsd ?? null).text}</td>
                  <td className="text-right text-xs"><SolscanLink href={r.solscanEntry ?? solscanTxUrl(r.entryTx)} label="entry" /> · <SolscanLink href={r.solscanMint ?? solscanAccountUrl(r.mint)} label="token" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#121212] p-4 overflow-x-auto">
        <h2 className="text-sm font-semibold mb-3">Trade history</h2>
        {p.closed.length === 0 ? <p className="text-sm text-white/40">No closed trades yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-[11px] text-white/40 uppercase tracking-wider">
              <tr><th className="text-left py-2">Token</th><th className="text-right">Size</th><th className="text-right">P&L</th><th className="text-right">0.5% fee</th><th className="text-right">Fees total</th><th className="text-left">Exit</th><th className="text-right">Solscan</th></tr>
            </thead>
            <tbody>
              {p.closed.map((r) => (
                <tr key={r.id} className="border-t border-white/10">
                  <td className="py-2 font-semibold">{r.symbol}{r.simulated ? <span className="ml-1 text-[10px] text-white/35">paper</span> : null}</td>
                  <td className="text-right font-mono">{usd(r.sizeUsd).text}</td>
                  <td className={`text-right font-mono ${cls(r.pnlUsd)}`}>{usd(r.pnlUsd).text} <span className="text-xs">{pct(r.pnlPct)}</span></td>
                  <td className="text-right font-mono text-amber-300">{usd(r.operatorFeeUsd ?? null).text}</td>
                  <td className="text-right font-mono text-white/60">{usd(r.feesUsd ?? null).text}</td>
                  <td className="text-white/60 text-xs">{r.exitReason ?? '—'}</td>
                  <td className="text-right text-xs">
                    <SolscanLink href={r.solscanEntry ?? solscanTxUrl(r.entryTx)} label="entry" /> · <SolscanLink href={r.solscanExit ?? solscanTxUrl(r.exitTx)} label="exit" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {p.demo && <p className="text-[11px] text-white/35 mt-3">Sample paper trades for the public demo. Live fills will link to Solscan when a signature exists.</p>}
      </section>
      <p className="text-[11px] text-white/30 text-center">Past results do not guarantee future outcomes. Not financial advice. Trading involves risk of loss. <Link href="/demo/disclaimer" className="text-amber-300">Terms &amp; risk</Link></p>
    </div>
  );
}
