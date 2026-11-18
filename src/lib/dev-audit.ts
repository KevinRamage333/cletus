import type { Inspection } from './inspector';
export interface Finding { label: string; detail: string; severity: 'info' | 'watch' | 'high' }
/** Turn a live inspection into audit findings. Pure; every number comes from the inspection. */
export function devAuditFrom(i: Inspection) {
  const f: Finding[] = [];
  const txs = i.transactions;
  const created = txs.filter((t) => /TOKEN_MINT|CREATE|INITIALIZE_MINT|CREATE_POOL|ADD_LIQUIDITY/i.test(t.type)).length;
  const failed = txs.filter((t) => t.failed).length;
  const swaps = txs.filter((t) => /SWAP/i.test(t.type)).length;
  const withdraw = txs.filter((t) => /WITHDRAW_LIQUIDITY|REMOVE_LIQUIDITY|BURN/i.test(t.type)).length;
  if (i.kind === 'token' && i.token) {
    const t = i.token;
    f.push({ label: 'Mint authority', detail: t.mintAuthority ? `still set (${t.mintAuthority.slice(0, 6)}…): supply can be inflated` : 'revoked', severity: t.mintAuthority ? 'high' : 'info' });
    f.push({ label: 'Freeze authority', detail: t.freezeAuthority ? 'still set: holders can be frozen' : 'revoked', severity: t.freezeAuthority ? 'high' : 'info' });
    const top = t.topHolders[0]; const top10 = t.topHolders.reduce((s, h) => s + h.pct, 0);
    if (top) f.push({ label: 'Top holder', detail: `${top.pct.toFixed(1)}% of supply (may be a pool or locker)`, severity: top.pct > 20 ? 'watch' : 'info' });
    if (t.topHolders.length) f.push({ label: 'Top-10 concentration', detail: `${top10.toFixed(1)}% of supply`, severity: top10 > 50 ? 'high' : top10 > 30 ? 'watch' : 'info' });
    if (t.liquidityUsd !== null) f.push({ label: 'Pool liquidity', detail: `$${Math.round(t.liquidityUsd).toLocaleString()}`, severity: t.liquidityUsd < 50_000 ? 'watch' : 'info' });
  } else {
    f.push({ label: 'SOL balance', detail: i.solBalance == null ? 'Unavailable (balance read failed)' : `${i.solBalance.toFixed(4)} SOL`, severity: 'info' });
    f.push({ label: 'Token holdings', detail: `${i.holdings.length} fungible tokens${i.holdingsTotalUsd !== null ? ` (~$${Math.round(i.holdingsTotalUsd).toLocaleString()} priced)` : ''}`, severity: 'info' });
    if (withdraw) f.push({ label: 'Liquidity removals / burns', detail: `${withdraw} in the last ${txs.length} transactions`, severity: 'high' });
  }
  if (created) f.push({ label: 'Token / pool creation activity', detail: `${created} creation-type transactions in the last ${txs.length}`, severity: created >= 3 ? 'watch' : 'info' });
  if (swaps) f.push({ label: 'Swaps', detail: `${swaps} of the last ${txs.length} transactions`, severity: 'info' });
  if (failed) f.push({ label: 'Failed transactions', detail: `${failed} of the last ${txs.length}`, severity: failed > txs.length / 2 ? 'watch' : 'info' });
  if (!txs.length) f.push({ label: 'Activity', detail: 'no recent transactions found', severity: 'watch' });
  const counterparties = new Set<string>(txs.flatMap((t) => t.counterparties ?? []).filter((a) => a !== i.address));
  const high = f.filter((x) => x.severity === 'high').length, watch = f.filter((x) => x.severity === 'watch').length;
  const status: 'clean' | 'watch' | 'high_risk' = high ? 'high_risk' : watch ? 'watch' : 'clean';
  const summary = `${i.kind === 'token' ? 'Token' : 'Wallet'}: ${high} high-risk and ${watch} watch findings from ${txs.length} recent transactions (${i.source.join(', ')}). ${counterparties.size ? `${counterparties.size} distinct counterparties.` : ''} Automated heuristics only; not proof either way.`;
  return { wallet: i.address, kind: i.kind, status, summary, tokensCreated: created, relatedWallets: counterparties.size, findings: f, at: new Date().toISOString(), inspection: i };
}
