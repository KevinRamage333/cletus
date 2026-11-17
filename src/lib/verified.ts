/**
 * Cletus Verified: automated token-developer verification. Pure rules, unit-tested in tests/verified.test.ts.
 *
 * A token earns the badge only when ALL of these hold:
 *   1. The applicant signed a Cletus challenge with a wallet that controls the token
 *      (Solana: mint / freeze / metadata update authority or the recorded creator;
 *       EVM: contract owner() or the recorded deployer).
 *   2. Every required automated safety check passes. A check we could not read is NOT a pass.
 * The badge expires after VERIFIED_TTL_DAYS and must be renewed with a fresh audit.
 * It is an automated check, not investment advice, an endorsement or a guarantee.
 */
export type ListingNetwork = 'solana' | 'ethereum' | 'base' | 'bnb' | 'polygon' | 'cronos';
export const LISTING_NETWORKS: Array<{ id: ListingNetwork; name: string; kind: 'solana' | 'evm'; chainId: number | null; dexId: string; explorer: string }> = [
  { id: 'solana', name: 'Solana', kind: 'solana', chainId: null, dexId: 'solana', explorer: 'https://solscan.io/token/' },
  { id: 'ethereum', name: 'Ethereum', kind: 'evm', chainId: 1, dexId: 'ethereum', explorer: 'https://etherscan.io/token/' },
  { id: 'base', name: 'Base', kind: 'evm', chainId: 8453, dexId: 'base', explorer: 'https://basescan.org/token/' },
  { id: 'bnb', name: 'BNB Chain', kind: 'evm', chainId: 56, dexId: 'bsc', explorer: 'https://bscscan.com/token/' },
  { id: 'polygon', name: 'Polygon', kind: 'evm', chainId: 137, dexId: 'polygon', explorer: 'https://polygonscan.com/token/' },
  { id: 'cronos', name: 'Cronos', kind: 'evm', chainId: 25, dexId: 'cronos', explorer: 'https://cronoscan.com/token/' },
];
export const networkMeta = (id: string) => LISTING_NETWORKS.find((n) => n.id === id) ?? null;

export const VERIFIED_TTL_DAYS = 30;
export const VERIFIED_DISCLAIMER = 'Cletus Verified is an automated check of public on-chain data and a wallet signature at one point in time. It is not investment advice, an endorsement, a recommendation or a guarantee. Projects can change after verification. Always do your own research.';

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
/** Normalised address for a network (EVM lower-cased), or null if malformed. */
export function normalizeAddress(network: ListingNetwork, address: string): string | null {
  const a = String(address ?? '').trim();
  if (network === 'solana') return SOL_ADDR.test(a) ? a : null;
  return EVM_ADDR.test(a) ? a.toLowerCase() : null;
}
export const tokenKey = (network: ListingNetwork, token: string) => `${network}:${network === 'solana' ? token : token.toLowerCase()}`;

export type CheckState = 'pass' | 'warn' | 'fail' | 'unknown';
export interface VerifyCheck { id: string; label: string; state: CheckState; detail: string; required: boolean }

/** Facts gathered server-side from public sources. null = could not be read. */
export interface TokenSecurityFacts {
  network: ListingNetwork;
  token: string;
  name: string | null;
  symbol: string | null;
  /** Wallets that demonstrably control the token, with how we know. */
  controllers: Array<{ address: string; role: string }>;
  mintAuthority?: string | null; // Solana; undefined = unreadable
  freezeAuthority?: string | null; // Solana
  token2022Risks?: string[]; // Solana Token-2022 extensions (permanent delegate, transfer hook, default frozen…)
  ownerCanMint?: boolean | null; // EVM (GoPlus is_mintable / owner privileges)
  top1Pct: number | null;
  top10Pct: number | null;
  liquidityUsd: number | null;
  lpLockedOrBurnedPct: number | null;
  honeypot: boolean | null;
  sellTaxPct: number | null;
  buyTaxPct: number | null;
  sources: string[];
  errors: string[];
}

export function sameAddress(network: ListingNetwork, a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return network === 'solana' ? a === b : a.toLowerCase() === b.toLowerCase();
}

/** The control role of `wallet` over the token, or null if it has none. */
export function controlRole(f: Pick<TokenSecurityFacts, 'network' | 'controllers'>, wallet: string): string | null {
  return f.controllers.find((c) => sameAddress(f.network, c.address, wallet))?.role ?? null;
}

export function evaluateVerificationChecks(f: TokenSecurityFacts): VerifyCheck[] {
  const c: VerifyCheck[] = [];
  if (f.network === 'solana') {
    c.push(f.mintAuthority === undefined
      ? { id: 'mint', label: 'Mint authority', state: 'unknown', detail: 'Mint account could not be read.', required: true }
      : f.mintAuthority ? { id: 'mint', label: 'Mint authority', state: 'fail', detail: 'Still active: supply can be inflated. Revoke it to qualify.', required: true }
        : { id: 'mint', label: 'Mint authority', state: 'pass', detail: 'Revoked. Supply is fixed.', required: true });
    c.push(f.freezeAuthority === undefined
      ? { id: 'freeze', label: 'Freeze authority', state: 'unknown', detail: 'Mint account could not be read.', required: true }
      : f.freezeAuthority ? { id: 'freeze', label: 'Freeze authority', state: 'fail', detail: 'Still active: holders can be frozen. Revoke it to qualify.', required: true }
        : { id: 'freeze', label: 'Freeze authority', state: 'pass', detail: 'Revoked.', required: true });
    if (f.token2022Risks?.length) c.push({ id: 'extensions', label: 'Token-2022 extensions', state: 'fail', detail: f.token2022Risks.join(' '), required: true });
  } else {
    c.push(f.ownerCanMint == null
      ? { id: 'mint', label: 'Owner mint / privileges', state: 'unknown', detail: 'Contract privileges could not be read.', required: true }
      : f.ownerCanMint ? { id: 'mint', label: 'Owner mint / privileges', state: 'fail', detail: 'The owner can mint new supply or change balances.', required: true }
        : { id: 'mint', label: 'Owner mint / privileges', state: 'pass', detail: 'No owner minting detected.', required: true });
  }
  if (f.top1Pct == null || f.top10Pct == null) c.push({ id: 'holders', label: 'Holder concentration', state: 'unknown', detail: 'Largest holders could not be read.', required: true });
  else {
    const s: CheckState = f.top1Pct >= 20 || f.top10Pct >= 60 ? 'fail' : f.top1Pct >= 10 || f.top10Pct >= 35 ? 'warn' : 'pass';
    c.push({ id: 'holders', label: 'Holder concentration', state: s, detail: `Largest holder ${f.top1Pct.toFixed(1)}%, top 10 ${f.top10Pct.toFixed(1)}% (pools included).`, required: true });
  }
  if (f.liquidityUsd == null) c.push({ id: 'liquidity', label: 'Liquidity', state: 'unknown', detail: 'No DEX pool found.', required: true });
  else c.push({ id: 'liquidity', label: 'Liquidity', state: f.liquidityUsd < 10_000 ? 'fail' : f.liquidityUsd < 50_000 ? 'warn' : 'pass', detail: `$${Math.round(f.liquidityUsd).toLocaleString('en-US')} in the deepest pool.`, required: true });
  // LP lock/burn and honeypot data come from third-party scanners. On EVM a missing reading fails closed (Audit H2);
  // on Solana (no honeypot contracts, LP data often absent) unknown is shown but not required. A bad reading always fails.
  const evm = f.network !== 'solana';
  if (f.lpLockedOrBurnedPct == null) c.push({ id: 'lp', label: 'LP locked or burned', state: 'unknown', detail: 'LP lock data not available for this pool.', required: evm });
  else c.push({ id: 'lp', label: 'LP locked or burned', state: f.lpLockedOrBurnedPct >= 90 ? 'pass' : f.lpLockedOrBurnedPct >= 50 ? 'warn' : 'fail', detail: `${f.lpLockedOrBurnedPct.toFixed(0)}% of LP locked or burned.`, required: evm || f.lpLockedOrBurnedPct < 50 });
  const taxes = `buy tax ${f.buyTaxPct == null ? '?' : f.buyTaxPct.toFixed(1)}%, sell tax ${f.sellTaxPct == null ? '?' : f.sellTaxPct.toFixed(1)}%`;
  const bad = f.honeypot === true || (f.sellTaxPct ?? 0) > 10 || (f.buyTaxPct ?? 0) > 10;
  const unknown = f.honeypot == null || (evm && (f.sellTaxPct == null || f.buyTaxPct == null));
  if (bad) c.push({ id: 'honeypot', label: 'Honeypot / tax', state: 'fail', detail: f.honeypot ? `Flagged as a honeypot (${taxes}).` : `Tax over 10% (${taxes}).`, required: true });
  else if (unknown) c.push({ id: 'honeypot', label: 'Honeypot / tax', state: 'unknown', detail: `No complete honeypot simulation available (${taxes}).`, required: evm });
  else c.push({ id: 'honeypot', label: 'Honeypot / tax', state: 'pass', detail: taxes, required: evm });
  return c;
}

export interface VerificationDecision { verified: boolean; reasons: string[]; role: string | null; checks: VerifyCheck[] }

/** The single decision rule. `signatureValid` must come from a server-side signature verification. */
export function decideVerification(f: TokenSecurityFacts, wallet: string, signatureValid: boolean): VerificationDecision {
  const checks = evaluateVerificationChecks(f);
  const reasons: string[] = [];
  if (!signatureValid) reasons.push('Wallet signature did not verify.');
  const role = controlRole(f, wallet);
  if (!role) reasons.push(f.controllers.length ? 'The signing wallet is not the deployer, owner or an authority of this token.' : 'No controlling wallet could be identified for this token, so ownership cannot be proven.');
  for (const ch of checks) {
    if (ch.state === 'fail') reasons.push(`${ch.label}: ${ch.detail}`);
    else if (ch.required && ch.state === 'unknown') reasons.push(`${ch.label} could not be verified. Try again later.`);
  }
  return { verified: reasons.length === 0, reasons, role, checks };
}

export function badgeExpiry(issuedAt: Date, ttlDays = VERIFIED_TTL_DAYS): Date {
  return new Date(issuedAt.getTime() + ttlDays * 86_400_000);
}
export function isBadgeActive(r: { status: string; expiresAt: string | Date | null }, now = Date.now()): boolean {
  if (r.status !== 'verified' || !r.expiresAt) return false;
  return new Date(r.expiresAt).getTime() > now;
}

/** Badges and boosts are re-checked against live facts at most this often (Audit H3). */
export const RECHECK_TTL_MS = 60 * 60_000;

/**
 * Re-check of an issued badge (or boosted token) against fresh facts. The badge drops when liquidity falls under
 * $10k, a honeypot/tax flag appears, or (Solana) a mint/freeze authority is re-enabled / (EVM) owner minting appears.
 * Unreadable facts keep the previous state only until the recheck TTL; the caller decides that.
 */
export function recheckDrops(f: Pick<TokenSecurityFacts, 'network' | 'liquidityUsd' | 'honeypot' | 'sellTaxPct' | 'buyTaxPct' | 'mintAuthority' | 'freezeAuthority' | 'ownerCanMint' | 'token2022Risks'>): string[] {
  const out: string[] = [];
  if (f.liquidityUsd != null && f.liquidityUsd < 10_000) out.push('Liquidity fell under $10,000.');
  if (f.honeypot === true) out.push('Now flagged as a honeypot.');
  if ((f.sellTaxPct ?? 0) > 10 || (f.buyTaxPct ?? 0) > 10) out.push('Tax rose over 10%.');
  if (f.network === 'solana') {
    if (f.mintAuthority) out.push('Mint authority was re-enabled.');
    if (f.freezeAuthority) out.push('Freeze authority was re-enabled.');
    for (const r of f.token2022Risks ?? []) out.push(r);
  } else if (f.ownerCanMint) out.push('Owner can now mint or change balances.');
  return out;
}

/** Latest record wins: a newer failed/revoked audit hides an older verified badge. */
export function latestRecordByToken<T extends { network: string; token: string; createdAt: string | Date }>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.network}:${r.network === 'solana' ? r.token : r.token.toLowerCase()}`;
    const cur = m.get(k);
    if (!cur || new Date(r.createdAt).getTime() > new Date(cur.createdAt).getTime()) m.set(k, r);
  }
  return [...m.values()];
}

/** The exact text the developer signs. Bound to network, token, wallet, nonce and expiry. Never a transaction. */
export function verificationMessage(p: { network: ListingNetwork; token: string; wallet: string; nonce: string; issuedAt: string; expiresAt: string; domain: string }): string {
  return [
    'Cletus Verified — developer ownership proof',
    `Domain: ${p.domain}`,
    `Network: ${p.network}`,
    `Token: ${p.token}`,
    `Wallet: ${p.wallet}`,
    `Nonce: ${p.nonce}`,
    `Issued: ${p.issuedAt}`,
    `Expires: ${p.expiresAt}`,
    '',
    'This signature proves you control this wallet. It is not a transaction, costs nothing and grants no permission to move funds.',
  ].join('\n');
}
