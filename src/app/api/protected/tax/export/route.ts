import { prisma } from '@/lib/db';
import { errorResponse } from '@/lib/auth';
import { appContext } from '@/lib/app-api';
export const dynamic = 'force-dynamic';
const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** Trade history CSV for the user's own tax records. Paper (simulated) trades are flagged and are not real disposals. */
export async function GET() {
  try {
    const { u, a } = await appContext();
    const rows = await prisma.position.findMany({ where: { accountId: a.id, status: 'closed' }, orderBy: { closedAt: 'asc' } });
    const head = ['mode', 'symbol', 'mint', 'opened_at_utc', 'closed_at_utc', 'cost_basis_usd', 'proceeds_usd', 'fees_usd', 'realized_pnl_usd', 'pnl_pct', 'entry_price_usd', 'exit_price_usd', 'token_amount', 'exit_reason', 'entry_tx', 'exit_tx'];
    const lines = rows.map((p) => {
      const cost = p.sizeUsd + p.partialCostUsd; const pnl = p.pnlUsd ?? 0;
      return [p.simulated ? 'paper' : 'live', p.symbol, p.mint, p.openedAt, p.closedAt, cost.toFixed(2), (cost + pnl + p.feesUsd).toFixed(2), p.feesUsd.toFixed(2), pnl.toFixed(2), (p.pnlPct ?? 0).toFixed(2), p.entryPrice, p.exitPrice, p.tokenAmount, p.exitReason, p.entryTx, p.exitTx].map(esc).join(',');
    });
    const note = `# Cletus trade history for ${u.email}, exported ${new Date().toISOString()}. Rows marked "paper" are simulated and are not taxable disposals. Not tax advice; consult a tax professional.`;
    return new Response([note, head.join(','), ...lines].join('\n') + '\n', { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="cletus-trades-${new Date().toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
