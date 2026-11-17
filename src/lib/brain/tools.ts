/**
 * Read-only "self-awareness" functions the Brain can call. None of these can
 * place, modify, or cancel trades — the Brain is advisory only.
 */
import { readExchangeSpot } from '../exchange-spot-data';
import { prisma } from '../db';
import { getOperationsReport } from '../agents/operations';
import { getConfig, publicConfig } from '../config';
import { accountEquity, getEngineState, mem, periodPnl } from '../engine';
import { tierFor } from '../sizing';
import { scoreConfidence, backtestSummary } from '../calibration';
import { whaleActivity, socialHype, flowStatus } from '../flow-collector';
import { describeOwnerPlan } from '../owner-plan';

export interface ToolContext { userId: string; accountId: string; isAdmin: boolean }

type Schema = { type: 'OBJECT'; properties: Record<string, { type: string; description: string; enum?: string[] }>; required?: string[] };
export interface ToolDecl { name: string; description: string; parameters?: Schema }

const limitParam = { limit: { type: 'INTEGER', description: 'max items (default 10, max 50)' } };

export const TOOL_DECLARATIONS: ToolDecl[] = [
  { name: 'get_operations_report', description: 'Owner-only Operations Steward report on app database health, scheduled paper-worker heartbeats and position checks, and scanner freshness. Call before answering an owner question about service uptime or the paper worker.' },
  { name: 'get_status', description: 'Overall live status: trading mode, preset, kill switch, schedule, account equity/PnL, win rate, sizing tier, recovery/pause state, last scan summary.' },
  { name: 'get_positions', description: 'Currently open positions with entry, last price, unrealized PnL and entry composite score.' },
  { name: 'get_recent_trades', description: 'Recently closed trades with PnL, exit reason and the entry signal breakdown.', parameters: { type: 'OBJECT', properties: limitParam } },
  { name: 'get_signal_weights', description: 'The 8 learned signal weights with per-signal wins/trials (win rate), and the initial weights for comparison.' },
  { name: 'get_self_healing', description: 'Self-healing execution parameters: current priority fee, slippage, consecutive failures, pause state, last error, and the healing limits.' },
  { name: 'get_blocks', description: 'Recent pre-trade security audit failures and compliance-gate blocks (why tokens were NOT traded).', parameters: { type: 'OBJECT', properties: limitParam } },
  { name: 'get_config', description: 'Active configuration/preset: thresholds, exits, sizing tiers, schedule, compliance limits.' },
  { name: 'get_scan_candidates', description: 'Latest scanner results: tokens in the market-cap band ranked by volume/market-cap with composite scores, signals and audit results.', parameters: { type: 'OBJECT', properties: limitParam } },
  { name: 'get_exchange_spot_reference', description: 'Compare recent OKX and Bybit USDT spot prices for an exchange symbol. Reference data only. It cannot identify on-chain tokens, certify liquidity, or quote an executable fill.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING', description: 'Base exchange symbol, such as SOL or ETH. Do not include USDT.' } }, required: ['symbol'] } },
  { name: 'get_base_market_candidates', description: 'Fetch current read-only Base-chain token market snapshots (USD price, 24h volume, liquidity, FDV, 24h move, DEX and pair link). These are discovery candidates, not buy signals; Base paper trading and execution are disabled.', parameters: { type: 'OBJECT', properties: limitParam } },
  { name: 'get_base_paper_quote', description: 'Get a read-only Base Uniswap v3 quote and a non-persistent adverse-slippage paper-fill preview for one ERC-20 token versus native USDC. Requires tokenAddress, side (buy or sell), and amountIn. Reports L2 fee estimate only; Base L1 data fee is not included. Never places or broadcasts trades.', parameters: { type: 'OBJECT', properties: { tokenAddress: { type: 'STRING', description: 'Base ERC-20 token contract address' }, side: { type: 'STRING', description: 'buy or sell', enum: ['buy', 'sell'] }, amountIn: { type: 'STRING', description: 'Buy: USDC input amount. Sell: token input amount.' }, slippageBps: { type: 'INTEGER', description: 'Adverse paper-fill slippage in basis points; default 50, maximum 300.' } }, required: ['tokenAddress', 'side', 'amountIn'] } },
  { name: 'get_world_briefing', description: 'The latest rolling world briefing (crypto, macro, Fed, world news) plus SOL price and DexScreener trending tokens.' },
  { name: 'get_news', description: 'Recent stored news headlines, optionally by category.', parameters: { type: 'OBJECT', properties: { category: { type: 'STRING', description: 'crypto | macro | world | fed', enum: ['crypto', 'macro', 'world', 'fed'] }, ...limitParam } } },
  { name: 'get_backtest', description: 'Walk-forward backtest calibration: historical win rate, 95% interval and average net return per market-cap preset and score bucket, and whether the composite score was predictive out of sample. Use this before stating any probability or confidence.' },
  { name: 'get_whale_activity', description: 'On-chain big money movers for a tracked token (Helius): whale net flow, smart-money buys/sells, dev-wallet selling, fresh-wallet bundle clusters, top-holder concentration change, the confirm/veto verdict, fast-exit signal, and Solscan links. Use it as a confirmer/veto next to order flow, never as a buy signal.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING', description: 'token symbol, e.g. BONK' }, mint: { type: 'STRING', description: 'token mint address' } } } },
  { name: 'get_social_hype', description: 'X (Twitter) mention velocity/acceleration, organic vs bot/shill share, and hype-vs-price/flow divergence for a tracked token (e.g. rising hype into selling = exit liquidity). Confirmer/veto only, never a buy signal.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING', description: 'token symbol, e.g. BONK' }, mint: { type: 'STRING', description: 'token mint address' } } } },
  { name: 'get_owner_plan', description: "Owner money plan for Cletus's own trading wallet: current equity sizing tier and trade size, stop/take-profit, one-position rule, profit-sweep ladder (current base, next target, total paid out), and whether the sweep is armed. Use this to explain where he is on the ladder." },
  { name: 'get_journal', description: "Cletus's own self-reflection journal entries (after each closed trade and daily).", parameters: { type: 'OBJECT', properties: limitParam } },
];

const lim = (a: Record<string, unknown> | undefined, d = 10) => Math.max(1, Math.min(50, Number(a?.limit ?? d) || d));
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function runTool(name: string, args: Record<string, unknown> | undefined, ctx: ToolContext): Promise<unknown> {
  const c = getConfig();
  switch (name) {
    case 'get_operations_report':
      return ctx.isAdmin ? getOperationsReport(c) : { error: 'The operations report is available to app admins only.' };
    case 'get_status': {
      const a = await prisma.account.findUniqueOrThrow({ where: { id: ctx.accountId } });
      const [st, eq, pnl] = await Promise.all([getEngineState(), accountEquity(a), periodPnl(a.id, c.timezone)]);
      const closed = await prisma.position.count({ where: { accountId: a.id, status: 'closed' } });
      const wins = await prisma.position.count({ where: { accountId: a.id, status: 'closed', pnlUsd: { gt: 0 } } });
      const t = tierFor(a.realizedPnl, c.tiers);
      return {
        mode: c.mode, preset: c.preset, aggression: c.aggression, betaMode: c.betaMode, killSwitch: st.killSwitch, killReason: st.killReason,
        account: { name: a.name, isOperator: a.isOperator, startingBalance: a.startingBalance, cash: r2(a.cashUsd), equity: r2(eq.equity), exposure: r2(eq.exposure), realizedPnl: r2(a.realizedPnl), unrealizedPnl: r2(eq.openValue - eq.exposure), paused: a.paused, pauseReason: a.pauseReason, recoveryMode: a.recoveryMode, peakEquity: r2(a.peakEquity) },
        periodPnl: { day: r2(pnl.day), week: r2(pnl.week), month: r2(pnl.month) },
        trades: { closed, wins, winRate: closed ? r2(wins / closed) : null, open: eq.open.length },
        sizingTier: { tier: t.tier, multiplier: t.multiplier },
        engine: { scans: st.scanCount, lastScanAt: st.lastScanAt, lastScan: mem.lastScanSummary },
      };
    }
    case 'get_positions': {
      const open = await prisma.position.findMany({ where: { accountId: ctx.accountId, status: 'open' }, orderBy: { openedAt: 'desc' } });
      return open.map((p) => ({ symbol: p.symbol, mint: p.mint, sizeUsd: r2(p.sizeUsd), entryPrice: p.entryPrice, lastPrice: p.lastPrice, peakPrice: p.highestPrice, unrealizedPnlPct: r2((p.lastPrice / p.entryPrice - 1) * 100), compositeScore: r2(p.compositeScore), openedAt: p.openedAt, simulated: p.simulated }));
    }
    case 'get_recent_trades': {
      const rows = await prisma.position.findMany({ where: { accountId: ctx.accountId, status: 'closed' }, orderBy: { closedAt: 'desc' }, take: lim(args) });
      return rows.map((p) => ({ symbol: p.symbol, sizeUsd: r2(p.sizeUsd), pnlUsd: r2(p.pnlUsd ?? 0), pnlPct: r2(p.pnlPct ?? 0), exitReason: p.exitReason, openedAt: p.openedAt, closedAt: p.closedAt, compositeScore: r2(p.compositeScore), signals: JSON.parse(p.signals), simulated: p.simulated }));
    }
    case 'get_signal_weights': {
      const rows = await prisma.signalWeight.findMany();
      const init = c.initialWeights as Record<string, number>;
      const tot = Object.values(init).reduce((a, b) => a + b, 0);
      return rows.sort((a, b) => b.weight - a.weight).map((w) => ({ signal: w.name, weight: Number(w.weight.toFixed(4)), initialWeight: Number(((init[w.name] ?? 0) / tot).toFixed(4)), wins: w.wins, trials: w.trials, winRate: w.trials ? r2(w.wins / w.trials) : null }));
    }
    case 'get_self_healing': {
      const st = await getEngineState();
      return { priorityFeeLamports: st.priorityFeeLamports, slippageBps: st.slippageBps, consecutiveFailures: st.consecutiveFailures, pausedUntil: st.pausedUntil, lastError: st.lastError,
        limits: { basePriorityFee: c.priorityFeeLamports, maxPriorityFee: c.maxPriorityFeeLamports, escalation: c.priorityFeeEscalation, baseSlippageBps: Math.round(c.slippageTolerance * 10000), maxSlippageBps: c.maxSlippageBps, widenStepBps: c.slippageWidenStepBps, maxConsecutiveFailures: c.maxConsecutiveFailures, pauseMinutes: c.failurePauseMinutes } };
    }
    case 'get_blocks': {
      const logs = await prisma.logEntry.findMany({ where: { OR: [{ message: { startsWith: 'audit FAILED' } }, { message: { startsWith: 'compliance gate blocked' } }, { message: { startsWith: 'self-heal' } }], AND: [{ OR: [{ accountId: ctx.accountId }, { accountId: null }] }] }, orderBy: { createdAt: 'desc' }, take: lim(args, 15) });
      return logs.map((l) => ({ at: l.createdAt, message: l.message }));
    }
    case 'get_config': {
      const pc = publicConfig(c);
      return { mode: pc.mode, preset: pc.preset, aggression: pc.aggression, liveBlockedReason: pc.liveBlockedReason, schedule: { enable247: pc.enable247, start: pc.startTime, end: pc.endTime, days: pc.tradingDays, tz: pc.timezone },
        entry: { minCompositeScore: pc.minCompositeScore, maxOpenPositions: pc.maxOpenPositions, maxPositionSizeUsd: pc.maxPositionSizeUsd, marketCapBand: [pc.minMarketCap, pc.maxMarketCap], minVolume24hUsd: pc.minVolume24hUsd, volumeSpikeRule: `5m volume > ${pc.volumeSpikeMcapPct}% of mcap`, breakoutRule: `> ${pc.breakout5mPct}% price rise in 5m`, buyPressureRule: `buys > ${pc.buyPressureRatio * 100}% of 5m txns` },
        exits: { stopLossPct: pc.stopLossPct, takeProfitPct: pc.takeProfitPct, breakEvenTriggerPct: pc.breakEvenTriggerPct, trailing: pc.enableTrailingStop ? pc.trailingStopPct : 'off', holdTimeMinutes: pc.holdTimeMinutes },
        risk: { riskPerTradePct: pc.riskPerTradePct, maxTotalExposurePct: pc.maxTotalExposurePct, maxDrawdownPct: pc.maxDrawdownPct, dailyLossLimit: pc.dailyLossLimit, dailyPnlTarget: pc.dailyPnlTarget, tiers: pc.tiers },
        compliance: { maxVolumeShare: pc.secMaxVolumeShare, maxLiquidityShare: pc.secMaxLiquidityShare, washTradeWindowMin: pc.secWashTradeWindowMin, maxTradesPer5Min: pc.secMaxTradesPer5Min },
        audit: { maxHolderConcentration: pc.maxHolderConcentration, requireLiquidityLock: pc.requireLiquidityLock, maxAuditRiskScore: pc.maxAuditRiskScore } };
    }
    case 'get_scan_candidates':
      return mem.candidates.slice(0, lim(args)).map((x) => ({ symbol: x.symbol, mint: x.mint, marketCap: Math.round(x.marketCap), volume24h: Math.round(x.volume24h), volMcap: r2(x.volMcap), priceChangeH1: x.priceChangeH1, composite: Number(x.composite.toFixed(3)), historicalConfidence: scoreConfidence(x.composite, c.mcapPreset, Math.min(c.maxPositionSizeUsd, 500)), rejected: x.rejected ?? null, audit: x.audit ? { passed: x.audit.passed, failed: x.audit.checks.filter((k) => !k.passed).map((k) => k.name) } : null }));
    case 'get_base_paper_quote': {
      const tokenAddress = typeof args?.tokenAddress === 'string' ? args.tokenAddress : '';
      const side = args?.side === 'buy' || args?.side === 'sell' ? args.side : '';
      const amountIn = typeof args?.amountIn === 'string' ? args.amountIn : '';
      if (!tokenAddress || !side || !amountIn) return { error: 'tokenAddress, side (buy or sell), and amountIn are required.' };
      const slippageBps = args?.slippageBps === undefined ? undefined : Number(args.slippageBps);
      const { getBasePaperQuote, simulateBasePaperFill } = await import('../base-paper-simulator');
      const quote = await getBasePaperQuote({ tokenAddress, side, amountIn, slippageBps });
      return { quote, paperFillPreview: simulateBasePaperFill(quote), safety: 'No wallet, order, database write, account balance change, signing, or broadcast. L1 data fee is omitted, so total fee and net profitability are unknown.' };
    }
    case 'get_exchange_spot_reference':
      return readExchangeSpot(args?.symbol);
    case 'get_base_market_candidates': {
      const { fetchBaseMarketSnapshot } = await import('../base-market-data');
      const rows = await fetchBaseMarketSnapshot(Math.min(25, lim(args, 10)));
      return rows.map((p) => ({
        network: 'base', symbol: p.baseToken.symbol, name: p.baseToken.name, tokenAddress: p.baseToken.address,
        priceUsd: p.priceUsd, marketCapOrFdvUsd: p.fdvUsd, volume24hUsd: p.volume24hUsd,
        liquidityUsd: p.liquidityUsd, priceChange24hPct: p.priceChange24hPct,
        pairCreatedAtMs: p.pairCreatedAtMs, dex: p.dexId, pairAddress: p.pairAddress, url: p.url,
        note: 'Read-only discovery data; not an entry signal. Base paper trading is disabled.',
      }));
    }
    case 'get_world_briefing': {
      const [b, m] = await Promise.all([prisma.briefing.findFirst({ orderBy: { createdAt: 'desc' } }), prisma.marketSnapshot.findFirst({ orderBy: { createdAt: 'desc' } })]);
      return { briefing: b?.content ?? null, briefingAt: b?.createdAt ?? null, briefingSource: b?.source ?? null, solPriceUsd: m?.solPriceUsd ?? null, solChange24h: m?.solChange24h ?? null, trending: m ? JSON.parse(m.trending) : [] };
    }
    case 'get_news': {
      const cat = typeof args?.category === 'string' ? args.category : undefined;
      const rows = await prisma.newsItem.findMany({ where: cat ? { category: cat } : {}, orderBy: { publishedAt: 'desc' }, take: lim(args, 12) });
      return rows.map((n) => ({ source: n.source, category: n.category, title: n.title, publishedAt: n.publishedAt, url: n.url }));
    }
    case 'get_journal': {
      const rows = await prisma.journalEntry.findMany({ where: { OR: [{ accountId: ctx.accountId }, { accountId: null }] }, orderBy: { createdAt: 'desc' }, take: lim(args, 5) });
      return rows.map((j) => ({ kind: j.kind, title: j.title, content: j.content, at: j.createdAt }));
    }
    case 'get_whale_activity':
      return whaleActivity({ mint: typeof args?.mint === 'string' ? args.mint : undefined, symbol: typeof args?.symbol === 'string' ? args.symbol : undefined });
    case 'get_social_hype':
      return { ...socialHype({ mint: typeof args?.mint === 'string' ? args.mint : undefined, symbol: typeof args?.symbol === 'string' ? args.symbol : undefined }), collector: { xEnabled: flowStatus().xEnabled, xRequestsToday: flowStatus().xRequestsToday } };
    case 'get_owner_plan': {
      const a = await prisma.account.findFirst({ where: ctx.isAdmin ? { isOperator: true } : { id: ctx.accountId } });
      if (!a || (!a.isOperator && !ctx.isAdmin)) return { error: 'The money plan applies to the owner trading wallet only.' };
      const { accountEquity, mem } = await import('../engine');
      const { ownerPlanStatus } = await import('../profit-sweep');
      const eq = await accountEquity(a);
      const status = await ownerPlanStatus({ equityUsd: eq.equity, openPositions: eq.open.length, cashUsd: a.cashUsd, solPriceUsd: mem.solPrice || c.solPriceFallbackUsd });
      return { ...status, summary: describeOwnerPlan(status) };
    }
    case 'get_backtest':
      return backtestSummary();
    default:
      return { error: `unknown function ${name}` };
  }
}

/** Compact live snapshot injected into the system instruction on every turn. */
export async function selfSnapshot(ctx: ToolContext): Promise<string> {
  const s = (await runTool('get_status', {}, ctx)) as Awaited<ReturnType<typeof runTool>> & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const w = (await runTool('get_signal_weights', {}, ctx)) as Array<{ signal: string; weight: number; winRate: number | null }>;
  return JSON.stringify({ ...s, topWeights: w.slice(0, 4).map((x) => `${x.signal} ${(x.weight * 100).toFixed(1)}%${x.winRate !== null ? ` (win ${(x.winRate * 100).toFixed(0)}%)` : ''}`) });
}
