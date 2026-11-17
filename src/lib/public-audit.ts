/**
 * Public token audit (Cletus Audit page). Pure evaluation of public on-chain facts; unit-tested.
 * A check we could not verify is reported as "unknown" — never as passed.
 */
export type CheckState = 'pass' | 'warn' | 'fail' | 'unknown';
export interface PublicAuditCheck { id: string; label: string; state: CheckState; detail: string }
export interface MintFacts { mintAuthority: string | null; freezeAuthority: string | null; supplyRaw: string; decimals: number; program: 'spl-token' | 'token-2022' | 'unknown' }
export interface HolderFacts { topAccounts: Array<{ address: string; uiAmount: number; pct: number }>; top1Pct: number; top10Pct: number }

export function holderFacts(largest: Array<{ address: string; uiAmount: number | null }>, supplyUi: number): HolderFacts | null {
  if (!(supplyUi > 0) || !largest.length) return null;
  const topAccounts = largest.filter((a) => a.uiAmount != null).map((a) => ({ address: a.address, uiAmount: a.uiAmount as number, pct: ((a.uiAmount as number) / supplyUi) * 100 }));
  const top1Pct = topAccounts[0]?.pct ?? 0;
  const top10Pct = topAccounts.slice(0, 10).reduce((s, a) => s + a.pct, 0);
  return { topAccounts, top1Pct, top10Pct };
}

export function evaluatePublicAudit(mint: MintFacts | null, holders: HolderFacts | null, liquidityUsd: number | null): PublicAuditCheck[] {
  const checks: PublicAuditCheck[] = [];
  if (!mint) {
    checks.push({ id: 'mint', label: 'Mint authority', state: 'unknown', detail: 'Mint account could not be read from Solana RPC.' });
    checks.push({ id: 'freeze', label: 'Freeze authority', state: 'unknown', detail: 'Mint account could not be read from Solana RPC.' });
  } else {
    checks.push(mint.mintAuthority
      ? { id: 'mint', label: 'Mint authority', state: 'fail', detail: `Active (${mint.mintAuthority}). New supply can still be minted.` }
      : { id: 'mint', label: 'Mint authority', state: 'pass', detail: 'Revoked. Supply is fixed.' });
    checks.push(mint.freezeAuthority
      ? { id: 'freeze', label: 'Freeze authority', state: 'fail', detail: `Active (${mint.freezeAuthority}). Holder accounts can be frozen.` }
      : { id: 'freeze', label: 'Freeze authority', state: 'pass', detail: 'Revoked. Accounts cannot be frozen.' });
    if (mint.program === 'token-2022') checks.push({ id: 'program', label: 'Token program', state: 'warn', detail: 'Token-2022: extensions such as transfer fees or hooks may apply. Review before trading.' });
  }
  if (!holders) checks.push({ id: 'holders', label: 'Holder concentration', state: 'unknown', detail: 'Largest holders could not be read (public RPC may rate-limit this call).' });
  else {
    const state: CheckState = holders.top1Pct >= 20 || holders.top10Pct >= 60 ? 'fail' : holders.top1Pct >= 10 || holders.top10Pct >= 35 ? 'warn' : 'pass';
    checks.push({ id: 'holders', label: 'Holder concentration', state, detail: `Largest account ${holders.top1Pct.toFixed(1)}%, top 10 accounts ${holders.top10Pct.toFixed(1)}% of supply. Liquidity-pool accounts are included.` });
  }
  if (liquidityUsd == null) checks.push({ id: 'liquidity', label: 'Liquidity', state: 'unknown', detail: 'No DexScreener pool found.' });
  else checks.push({ id: 'liquidity', label: 'Liquidity', state: liquidityUsd < 10_000 ? 'fail' : liquidityUsd < 50_000 ? 'warn' : 'pass', detail: `$${Math.round(liquidityUsd).toLocaleString('en-US')} in the deepest pool.` });
  return checks;
}

export function auditVerdict(checks: PublicAuditCheck[]): { label: string; state: CheckState } {
  if (checks.some((c) => c.state === 'fail')) return { label: 'High risk signals found', state: 'fail' };
  if (checks.some((c) => c.state === 'unknown')) return { label: 'Incomplete: some checks could not be verified', state: 'unknown' };
  if (checks.some((c) => c.state === 'warn')) return { label: 'Caution', state: 'warn' };
  return { label: 'No red flags in these checks', state: 'pass' };
}

export const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
