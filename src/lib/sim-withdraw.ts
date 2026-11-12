/**
 * Public-user withdrawals are SIMULATED: they reduce the user's paper cash and
 * are recorded with mode 'simulation-usd'. Nothing is signed or sent. The only
 * allowed destination is the user's own connected wallet (their SIWS Solana
 * address, or the Base app address they connected in this browser).
 */
export const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
export const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type SimChain = 'solana' | 'base';
export type SimCheck = { ok: true; chain: SimChain; to: string; cents: number } | { ok: false; error: string };

export function checkSimWithdraw(b: { chain?: unknown; to?: unknown; amountUsd?: unknown }, u: { walletPublicKey: string | null }, cashUsd: number): SimCheck {
  const chain: SimChain = b.chain === 'base' ? 'base' : 'solana';
  const to = String(b.to ?? '').trim();
  if (chain === 'solana') {
    if (!u.walletPublicKey) return { ok: false, error: 'Connect a Solana wallet first' };
    if (to !== u.walletPublicKey) return { ok: false, error: 'You can only withdraw to your own connected wallet' };
  } else if (!EVM_ADDR.test(to)) {
    return { ok: false, error: 'Connect your Base app wallet first' };
  }
  const amt = Number(b.amountUsd);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: 'Enter an amount greater than 0' };
  const cents = Math.round(amt * 100);
  if (cents > Math.floor(cashUsd * 100 + 1e-6)) return { ok: false, error: `Not enough simulated cash (you have $${cashUsd.toFixed(2)})` };
  return { ok: true, chain, to, cents };
}
