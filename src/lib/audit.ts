/**
 * Pre-trade security audit: mint authority, freeze authority, LP lock,
 * honeypot (can we sell?), holder concentration, RugCheck risk score.
 */

export interface RugcheckReport {
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  score?: number;
  score_normalised?: number;
  rugged?: boolean;
  risks?: Array<{ name: string; level?: string; description?: string; score?: number }>;
  topHolders?: Array<{ address?: string; owner?: string; pct?: number; insider?: boolean }>;
  knownAccounts?: Record<string, { name?: string; type?: string }>;
  markets?: Array<{ pubkey?: string; marketType?: string; lp?: { lpLockedPct?: number; lpLockedUSD?: number } }>;
  totalMarketLiquidity?: number;
  transferFee?: { pct?: number };
}

export interface SellQuote { routeFound: boolean; priceImpactPct: number | null; error?: string }

export interface AuditParams {
  maxHolderConcentration: number; // fraction, e.g. 0.30
  requireLiquidityLock: boolean;
  minLpLockedPct: number;
  maxAuditRiskScore: number; // 0..100 (RugCheck normalised)
  maxSellPriceImpactPct: number;
}

export interface AuditCheck { name: string; passed: boolean; detail: string }
export interface AuditResult { passed: boolean; checks: AuditCheck[]; liquidityUsd: number | null; riskScore: number | null; topHolderPct: number | null; auditedAt: string }

/** Pure evaluation (unit-tested). A missing report fails closed. */
export function evaluateAudit(report: RugcheckReport | null, sell: SellQuote | null, p: AuditParams): AuditResult {
  const checks: AuditCheck[] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });

  if (!report) {
    add('rugcheck_report', false, 'RugCheck report unavailable — failing closed');
    return { passed: false, checks, liquidityUsd: null, riskScore: null, topHolderPct: null, auditedAt: new Date().toISOString() };
  }

  add('mint_authority', !report.mintAuthority, report.mintAuthority ? 'mint authority is still enabled (supply can be inflated)' : 'renounced');
  add('freeze_authority', !report.freezeAuthority, report.freezeAuthority ? 'freeze authority enabled (wallets can be frozen)' : 'renounced');
  add('not_rugged', !report.rugged, report.rugged ? 'RugCheck flags token as rugged' : 'ok');

  // LP lock: best market's locked %. Pump.fun bonding curves report 100% (no withdrawable LP).
  const lockPcts = (report.markets ?? []).map((m) => m.lp?.lpLockedPct ?? 0);
  const bestLock = lockPcts.length ? Math.max(...lockPcts) : 0;
  if (p.requireLiquidityLock) add('lp_locked', bestLock >= p.minLpLockedPct, `best LP locked ${bestLock.toFixed(1)}% (min ${p.minLpLockedPct}%)`);
  else add('lp_locked', true, `not required (best ${bestLock.toFixed(1)}%)`);

  // Holder concentration: ignore AMM pools / lockers / bonding curves (known accounts).
  const known = report.knownAccounts ?? {};
  const isProgramAccount = (h: { address?: string; owner?: string }) =>
    Boolean((h.owner && known[h.owner]) || (h.address && known[h.address]) || (report.markets ?? []).some((m) => m.pubkey && (m.pubkey === h.owner || m.pubkey === h.address)));
  const holders = (report.topHolders ?? []).filter((h) => !isProgramAccount(h));
  const topPct = holders.length ? Math.max(...holders.map((h) => h.pct ?? 0)) : 0;
  add('holder_concentration', topPct / 100 <= p.maxHolderConcentration, `top non-pool holder ${topPct.toFixed(2)}% (max ${(p.maxHolderConcentration * 100).toFixed(0)}%)`);

  const risk = report.score_normalised ?? null;
  add('risk_score', risk === null ? true : risk <= p.maxAuditRiskScore, risk === null ? 'no score' : `RugCheck score ${risk} (max ${p.maxAuditRiskScore})`);

  const danger = (report.risks ?? []).filter((r) => (r.level ?? '').toLowerCase() === 'danger');
  add('no_danger_risks', danger.length === 0, danger.length ? danger.map((r) => r.name).join('; ') : 'none');

  const fee = report.transferFee?.pct ?? 0;
  add('transfer_fee', fee <= 5, `transfer fee ${fee}%`);

  // Honeypot: Jupiter must find a sell route at an acceptable price impact.
  if (!sell) add('honeypot', false, 'sell route not checked — failing closed');
  else if (!sell.routeFound) add('honeypot', false, `no sell route${sell.error ? `: ${sell.error}` : ''} (possible honeypot)`);
  else add('honeypot', (sell.priceImpactPct ?? 0) <= p.maxSellPriceImpactPct, `sell route ok, impact ${(sell.priceImpactPct ?? 0).toFixed(2)}%`);

  return {
    passed: checks.every((c) => c.passed),
    checks,
    liquidityUsd: report.totalMarketLiquidity ?? null,
    riskScore: risk,
    topHolderPct: topPct,
    auditedAt: new Date().toISOString(),
  };
}

const SOL = 'So11111111111111111111111111111111111111112';

export async function fetchRugcheck(mint: string, apiKey: string | null): Promise<RugcheckReport | null> {
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {
      headers: { accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as RugcheckReport;
  } catch {
    return null;
  }
}

/** Quote selling `tokenAmountRaw` of the token for SOL via Jupiter (no transaction). */
export async function checkSellRoute(mint: string, tokenAmountRaw: bigint, jupiterBase: string, apiKey: string | null): Promise<SellQuote> {
  try {
    const url = `${jupiterBase}/quote?inputMint=${mint}&outputMint=${SOL}&amount=${tokenAmountRaw.toString()}&slippageBps=500`;
    const res = await fetch(url, { headers: apiKey ? { 'x-api-key': apiKey } : {}, signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!res.ok) return { routeFound: false, priceImpactPct: null, error: `HTTP ${res.status}` };
    const q = (await res.json()) as { outAmount?: string; priceImpactPct?: string; error?: string };
    if (!q.outAmount || q.outAmount === '0') return { routeFound: false, priceImpactPct: null, error: q.error };
    return { routeFound: true, priceImpactPct: Number(q.priceImpactPct ?? 0) * 100 };
  } catch (e) {
    return { routeFound: false, priceImpactPct: null, error: String((e as Error).message) };
  }
}

const cache = new Map<string, { at: number; result: AuditResult }>();
const TTL = 10 * 60_000;

/** Full audit for a mint, sized by the intended USD position. Cached 10 minutes. */
export async function auditToken(
  mint: string,
  opts: { priceUsd: number; sizeUsd: number; decimals?: number; params: AuditParams; rugcheckApiKey: string | null; jupiterBase: string; jupiterApiKey: string | null },
): Promise<AuditResult> {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < TTL) return hit.result;
  const report = await fetchRugcheck(mint, opts.rugcheckApiKey);
  const decimals = opts.decimals ?? (report as { token?: { decimals?: number } } | null)?.token?.decimals ?? 6;
  const tokens = opts.priceUsd > 0 ? opts.sizeUsd / opts.priceUsd : 0;
  const raw = BigInt(Math.max(1, Math.floor(tokens * 10 ** decimals)));
  const sell = await checkSellRoute(mint, raw, opts.jupiterBase, opts.jupiterApiKey);
  const result = evaluateAudit(report, sell, opts.params);
  cache.set(mint, { at: Date.now(), result });
  return result;
}
