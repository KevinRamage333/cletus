/**
 * Central configuration. Every tunable from the Cletus Trading Parameters Guide
 * is an env var. Resolution order (later wins):
 *   built-in defaults -> AGGRESSION_LEVEL table -> TRADING_PRESET -> explicit env vars
 *
 * Safety defaults: TRADING_MODE=simulation and the CONSERVATIVE_EARNER preset in every mode
 * (set TRADING_PRESET=NONE to opt out). Explicit env vars always win over the preset.
 */
import { parseTpLadder, type TpRung } from './exits';
import { parseSubmissionMode, type SubmissionMode } from './submission';
import { parseOwnerPlanConfig, resolveOperatorFeeWallet, type OwnerPlanConfig } from './owner-plan';

export type Env = Record<string, string | undefined>;
export type AggressionLevel = 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE' | 'MAXIMUM';
export type PresetName =
  | 'CONSERVATIVE_EARNER'
  | 'DAY_TRADER'
  | 'NIGHT_TRADER'
  | 'ALPHA_HUNTER_24_7'
  | 'WEEKEND_WARRIOR'
  | 'NONE';

export const SIGNAL_NAMES = [
  'volumeSpike',
  'momentum',
  'breakout',
  'velocitySurge',
  'microCapHeat',
  'nanoCapSpike',
  'liquidityBuild',
  'volMcapRatio',
] as const;
export type SignalName = (typeof SIGNAL_NAMES)[number];

const SIGNAL_ENV: Record<SignalName, [string, number]> = {
  volumeSpike: ['SIGNAL_VOLUME_SPIKE_WEIGHT', 0.15],
  momentum: ['SIGNAL_MOMENTUM_WEIGHT', 0.15],
  breakout: ['SIGNAL_BREAKOUT_WEIGHT', 0.12],
  velocitySurge: ['SIGNAL_VELOCITY_SURGE_WEIGHT', 0.12],
  microCapHeat: ['SIGNAL_MICRO_CAP_HEAT_WEIGHT', 0.15],
  nanoCapSpike: ['SIGNAL_NANO_CAP_SPIKE_WEIGHT', 0.12],
  liquidityBuild: ['SIGNAL_LIQUIDITY_BUILD_WEIGHT', 0.1],
  volMcapRatio: ['SIGNAL_VOL_MCAP_RATIO_WEIGHT', 0.09],
};

interface LevelParams {
  minCompositeScore: number;
  maxPositionSizeUsd: number;
  maxOpenPositions: number;
  slippageTolerance: number; // fraction, 0.05 = 5%
  priorityFeeLamports: number;
  tradeFrequencySeconds: number;
  minVolumeUsd: number;
  holdTimeMinutes: number;
}

export const AGGRESSION_LEVELS: Record<AggressionLevel, LevelParams> = {
  CONSERVATIVE: { minCompositeScore: 0.75, maxPositionSizeUsd: 1000, maxOpenPositions: 2, slippageTolerance: 0.02, priorityFeeLamports: 50000, tradeFrequencySeconds: 300, minVolumeUsd: 10000, holdTimeMinutes: 120 },
  MODERATE: { minCompositeScore: 0.65, maxPositionSizeUsd: 5000, maxOpenPositions: 5, slippageTolerance: 0.05, priorityFeeLamports: 100000, tradeFrequencySeconds: 120, minVolumeUsd: 5000, holdTimeMinutes: 60 },
  AGGRESSIVE: { minCompositeScore: 0.55, maxPositionSizeUsd: 15000, maxOpenPositions: 10, slippageTolerance: 0.1, priorityFeeLamports: 200000, tradeFrequencySeconds: 60, minVolumeUsd: 2000, holdTimeMinutes: 30 },
  MAXIMUM: { minCompositeScore: 0.45, maxPositionSizeUsd: 50000, maxOpenPositions: 20, slippageTolerance: 0.2, priorityFeeLamports: 500000, tradeFrequencySeconds: 30, minVolumeUsd: 1000, holdTimeMinutes: 10 },
};

/**
 * The 5 quick-start presets from the guide. The guide's per-preset
 * "expected profit" claims were intentionally removed: no returns are implied.
 */
export const PRESETS: Record<Exclude<PresetName, 'NONE'>, Env> = {
  CONSERVATIVE_EARNER: {
    ENABLE_24_7_TRADING: 'false', TRADING_START_TIME: '10:00', TRADING_END_TIME: '16:00',
    AGGRESSION_LEVEL: 'CONSERVATIVE', DAILY_PNL_TARGET: '500', DAILY_LOSS_LIMIT: '-300',
    STOP_LOSS_PERCENTAGE: '5.0', TAKE_PROFIT_PERCENTAGE: '15.0', MAX_POSITION_SIZE_USD: '1000', MAX_OPEN_POSITIONS: '2',
  },
  DAY_TRADER: {
    ENABLE_24_7_TRADING: 'false', TRADING_START_TIME: '09:00', TRADING_END_TIME: '17:00',
    TRADING_TIMEZONE: 'America/New_York', PAUSE_ON_WEEKENDS: 'true', AGGRESSION_LEVEL: 'AGGRESSIVE',
    DAILY_PNL_TARGET: '5000', DAILY_LOSS_LIMIT: '-2000', STOP_LOSS_PERCENTAGE: '8.0', TAKE_PROFIT_PERCENTAGE: '20.0',
    MAX_POSITION_SIZE_USD: '15000', MAX_OPEN_POSITIONS: '10',
  },
  NIGHT_TRADER: {
    ENABLE_24_7_TRADING: 'false', TRADING_START_TIME: '21:00', TRADING_END_TIME: '05:00',
    AGGRESSION_LEVEL: 'MODERATE', DAILY_PNL_TARGET: '2000', DAILY_LOSS_LIMIT: '-1000',
    STOP_LOSS_PERCENTAGE: '8.0', TAKE_PROFIT_PERCENTAGE: '20.0', MAX_POSITION_SIZE_USD: '5000', MAX_OPEN_POSITIONS: '5',
    ENABLE_TRAILING_STOP: 'true', TRAILING_STOP_PERCENTAGE: '5.0',
  },
  ALPHA_HUNTER_24_7: {
    ENABLE_24_7_TRADING: 'true', AGGRESSION_LEVEL: 'MAXIMUM', DAILY_PNL_TARGET: '10000', DAILY_LOSS_LIMIT: '-5000',
    STOP_LOSS_PERCENTAGE: '10.0', TAKE_PROFIT_PERCENTAGE: '25.0', MAX_POSITION_SIZE_USD: '50000', MAX_OPEN_POSITIONS: '20',
    MAX_DRAWDOWN_PERCENTAGE: '20.0',
  },
  WEEKEND_WARRIOR: {
    ENABLE_24_7_TRADING: 'false', TRADING_DAYS: '5,6', PAUSE_ON_WEEKENDS: 'false', TRADING_START_TIME: '00:00', TRADING_END_TIME: '23:59',
    AGGRESSION_LEVEL: 'AGGRESSIVE', DAILY_PNL_TARGET: '3000', DAILY_LOSS_LIMIT: '-1500',
    ENABLE_TRAILING_STOP: 'true', TRAILING_STOP_PERCENTAGE: '8.0',
  },
};

/** Market-cap band presets. BALANCED is the default; set MCAP_PRESET to switch (MIN/MAX_MARKET_CAP still override). */
export type McapPreset = 'DEGEN' | 'BALANCED' | 'SAFER';
export const MCAP_PRESETS: Record<McapPreset, { min: number; max: number; label: string }> = {
  DEGEN: { min: 10_000, max: 500_000, label: 'Degen $10k-$500k' },
  BALANCED: { min: 250_000, max: 5_000_000, label: 'Balanced $250k-$5M' },
  SAFER: { min: 5_000_000, max: 50_000_000, label: 'Safer $5M-$50M' },
};
export function parseMcapPreset(v: string | undefined): McapPreset {
  const s = (v ?? '').trim().toUpperCase();
  return s === 'DEGEN' || s === 'SAFER' ? s : 'BALANCED';
}

export interface SizingTier { tier: number; threshold: number; multiplier: number }

export interface Config {
  mode: 'simulation' | 'live';
  requestedMode: string;
  liveBlockedReason: string | null;
  preset: PresetName;
  aggression: AggressionLevel;
  betaMode: boolean;
  // schedule
  enable247: boolean; startTime: string; endTime: string; tradingDays: number[]; timezone: string; pauseOnWeekends: boolean;
  // level-scaled
  minCompositeScore: number; maxPositionSizeUsd: number; maxOpenPositions: number; slippageTolerance: number;
  priorityFeeLamports: number; tradeFrequencySeconds: number; positionMonitorSeconds: number; holdTimeMinutes: number;
  // pnl
  stopLossPct: number; takeProfitPct: number; breakEvenTriggerPct: number; enableTrailingStop: boolean; trailingStopPct: number; trailingArmPct: number;
  dailyPnlTarget: number; dailyLossLimit: number; weeklyPnlTarget: number; weeklyLossLimit: number; monthlyPnlTarget: number; monthlyLossLimit: number;
  tiers: SizingTier[];
  maxDrawdownPct: number; enableRecoveryMode: boolean; recoveryMultiplier: number; recoveryExitWins: number;
  // signals
  enableDynamicWeights: boolean; signalWeightSet: SignalWeightSet; initialWeights: Record<SignalName, number>; winAmplify: number; lossDampen: number; minSignalWeight: number;
  // risk
  maxPositionsPerCluster: number;
  riskPerTradePct: number; maxTotalExposurePct: number; equityProtectionLevel: number; minTradeUsd: number;
  // scanner / filters
  mcapPreset: McapPreset; minVolumeMcapRatio: number; enablePresetLab: boolean;
  minMarketCap: number; maxMarketCap: number; minVolume24hUsd: number; volumeSpikeMcapPct: number; breakout5mPct: number; buyPressureRatio: number; minLiquidityUsd: number; nanoCapMax: number;
  minTokenAgeHours: number; maxHolderConcentration: number; maxHourlyPriceMovement: number; requireLiquidityLock: boolean; minLpLockedPct: number;
  scanTopN: number; auditTopN: number;
  // audit
  maxAuditRiskScore: number; rugcheckApiKey: string | null; maxSellPriceImpactPct: number;
  // execution & self-healing
  txConfirmationTimeoutSec: number; txRetryCount: number; priorityFeeEscalation: number; maxPriorityFeeLamports: number;
  slippageWidenStepBps: number; maxSlippageBps: number; maxConsecutiveFailures: number; failurePauseMinutes: number;
  jupiterApiKey: string | null; jupiterBaseUrl: string; rpcUrl: string;
  // operator / platform fee (Jupiter referral program)
  operatorFeeWallet: string; operatorFeeBps: number; operatorReferralAccount: string | null; operatorFeeOnOwner: boolean;
  // compliance gate
  secMaxVolumeShare: number; secMaxLiquidityShare: number; secWashTradeWindowMin: number; secMaxTradesPer5Min: number;
  // simulation
  simStartingBalanceUsd: number; simFeeBps: number; solPriceFallbackUsd: number;
  // AI
  enableAiBrain: boolean; geminiModel: string; hasGeminiKey: boolean;
  enableKillSwitch: boolean;
  // hard risk limits
  maxDailyLossPct: number; maxPositionPctOfEquity: number; maxConsecutiveLosses: number;
  // exits
  tpLadder: TpRung[]; stalePositionMinutes: number; staleBandPct: number;
  // extra audit checks
  maxTop10HolderPct: number; devSellCheck: boolean; blockIfDevExited: boolean; devExitLookbackHours: number;
  // live submission path
  submissionMode: SubmissionMode; privateRpcUrl: string | null; jitoBlockEngineUrl: string; jitoTipLamports: number;
  // owner money plan (operator wallet only)
  ownerPlan: OwnerPlanConfig;
}

const num = (v: string | undefined, d: number) => {
  if (v === undefined || v.trim() === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));
const str = (v: string | undefined, d: string) => (v === undefined || v.trim() === '' ? d : v.trim());

/**
 * Named composite scoring sets. `classic` = the original 8-signal weighted score (DB/self-learned weights).
 * `liquidity` = the backtest-backed shape: deep, growing liquidity and fresh activity, not chasing pumps.
 */
export const SIGNAL_WEIGHT_SETS = ['classic', 'liquidity'] as const;
export type SignalWeightSet = (typeof SIGNAL_WEIGHT_SETS)[number];
export function parseSignalWeightSet(v: string | undefined): SignalWeightSet {
  const k = (v ?? '').trim().toLowerCase();
  return (SIGNAL_WEIGHT_SETS as readonly string[]).includes(k) ? (k as SignalWeightSet) : 'classic';
}

export function hasWalletKey(env: Env): boolean {
  return Boolean((env.TRADING_WALLET_PRIVATE_KEY && env.TRADING_WALLET_PRIVATE_KEY.trim()) || (env.TRADING_WALLET_KEYPAIR_PATH && env.TRADING_WALLET_KEYPAIR_PATH.trim()));
}

export function buildConfig(rawEnv: Env = process.env): Config {
  const requestedMode = str(rawEnv.TRADING_MODE, 'simulation').toLowerCase();
  let liveBlockedReason: string | null = null;
  let mode: 'simulation' | 'live' = 'simulation';
  if (requestedMode === 'live') {
    if (!hasWalletKey(rawEnv)) liveBlockedReason = 'TRADING_MODE=live but no TRADING_WALLET_PRIVATE_KEY / TRADING_WALLET_KEYPAIR_PATH is set';
    else if (bool(rawEnv.BETA_MODE, false) && !bool(rawEnv.ALLOW_LIVE_IN_BETA, false)) liveBlockedReason = 'BETA_MODE=true keeps the bot in simulation (set ALLOW_LIVE_IN_BETA=true to override)';
    else mode = 'live';
  }

  // Conservative is the default preset in every mode; TRADING_PRESET=NONE opts out.
  let preset = str(rawEnv.TRADING_PRESET, 'CONSERVATIVE_EARNER').toUpperCase() as PresetName;
  if (preset !== 'NONE' && !(preset in PRESETS)) preset = 'CONSERVATIVE_EARNER';

  // Explicit env overrides win over the preset.
  const presetVals = preset === 'NONE' ? {} : PRESETS[preset];
  const env: Env = { ...presetVals };
  for (const [k, v] of Object.entries(rawEnv)) if (v !== undefined && v !== '') env[k] = v;

  let aggression = str(env.AGGRESSION_LEVEL, mode === 'live' ? 'CONSERVATIVE' : 'MODERATE').toUpperCase() as AggressionLevel;
  if (!(aggression in AGGRESSION_LEVELS)) aggression = 'MODERATE';
  const L = AGGRESSION_LEVELS[aggression];
  const lv = (key: keyof LevelParams, envKey: string) => num(env[envKey], num(env[`${aggression}_${envKey}`], L[key] as number));

  const initialWeights = Object.fromEntries(SIGNAL_NAMES.map((s) => [s, num(env[SIGNAL_ENV[s][0]], SIGNAL_ENV[s][1])])) as Record<SignalName, number>;

  // Progressive sizing tiers. $60k+ is 3.0x everywhere (guide inconsistency fixed).
  const tiers: SizingTier[] = [
    { tier: 1, threshold: num(env.TIER_1_PNL_THRESHOLD, 0), multiplier: num(env.TIER_1_CLIP_MULTIPLIER, 1.0) },
    { tier: 2, threshold: num(env.TIER_2_PNL_THRESHOLD, 10000), multiplier: num(env.TIER_2_CLIP_MULTIPLIER, 1.5) },
    { tier: 3, threshold: num(env.TIER_3_PNL_THRESHOLD, 20000), multiplier: num(env.TIER_3_CLIP_MULTIPLIER, 2.0) },
    { tier: 4, threshold: num(env.TIER_4_PNL_THRESHOLD, 40000), multiplier: num(env.TIER_4_CLIP_MULTIPLIER, 2.5) },
    { tier: 5, threshold: num(env.TIER_5_PNL_THRESHOLD, 60000), multiplier: num(env.TIER_5_CLIP_MULTIPLIER, 3.0) },
  ];

  const slippageTolerance = lv('slippageTolerance', 'SLIPPAGE_TOLERANCE');
  const mcapPreset = parseMcapPreset(env.MCAP_PRESET);

  return {
    mode, requestedMode, liveBlockedReason, preset, aggression,
    betaMode: bool(env.BETA_MODE, true),
    enable247: bool(env.ENABLE_24_7_TRADING, false),
    startTime: str(env.TRADING_START_TIME, '09:00'),
    endTime: str(env.TRADING_END_TIME, '17:00'),
    tradingDays: str(env.TRADING_DAYS, '0,1,2,3,4').split(',').map((d) => Number(d.trim())).filter((d) => d >= 0 && d <= 6),
    timezone: str(env.TRADING_TIMEZONE, 'America/New_York'),
    pauseOnWeekends: bool(env.PAUSE_ON_WEEKENDS, true),
    minCompositeScore: lv('minCompositeScore', 'MIN_COMPOSITE_SCORE'),
    maxPositionSizeUsd: lv('maxPositionSizeUsd', 'MAX_POSITION_SIZE_USD'),
    // Up to 20 concurrent positions by default; the portfolio exposure cap and per-position cap bound the risk.
    maxOpenPositions: num(rawEnv.MAX_OPEN_POSITIONS, 20),
    maxPositionsPerCluster: num(env.MAX_POSITIONS_PER_CLUSTER, 3),
    slippageTolerance,
    priorityFeeLamports: lv('priorityFeeLamports', 'PRIORITY_FEE_LAMPORTS'),
    tradeFrequencySeconds: Math.max(10, lv('tradeFrequencySeconds', 'TRADE_FREQUENCY_SECONDS')),
    // Fast exit checks: poll open-position prices every 3s by default (min 2s) so stops don't gap far past their level.
    positionMonitorSeconds: Math.max(2, num(env.POSITION_MONITOR_SECONDS, 3)),
    holdTimeMinutes: lv('holdTimeMinutes', 'HOLD_TIME_MINUTES'),
    stopLossPct: num(env.STOP_LOSS_PERCENTAGE, 10),
    takeProfitPct: num(env.TAKE_PROFIT_PERCENTAGE, 25),
    breakEvenTriggerPct: num(env.BREAK_EVEN_TRIGGER_PERCENTAGE, 5),
    enableTrailingStop: bool(env.ENABLE_TRAILING_STOP, true),
    trailingStopPct: num(env.TRAILING_STOP_PERCENTAGE, 5),
    trailingArmPct: num(env.TRAILING_ARM_PERCENTAGE, 0),
    dailyPnlTarget: num(env.DAILY_PNL_TARGET, 5000),
    dailyLossLimit: -Math.abs(num(env.DAILY_LOSS_LIMIT, -2000)),
    weeklyPnlTarget: num(env.WEEKLY_PNL_TARGET, 30000),
    weeklyLossLimit: -Math.abs(num(env.WEEKLY_LOSS_LIMIT, -10000)),
    monthlyPnlTarget: num(env.MONTHLY_PNL_TARGET, 100000),
    monthlyLossLimit: -Math.abs(num(env.MONTHLY_LOSS_LIMIT, -30000)),
    tiers,
    maxDrawdownPct: num(env.MAX_DRAWDOWN_PERCENTAGE, 15),
    enableRecoveryMode: bool(env.ENABLE_RECOVERY_MODE, true),
    recoveryMultiplier: num(env.RECOVERY_MODE_AGGRESSION_MULTIPLIER, 0.5),
    recoveryExitWins: num(env.RECOVERY_MODE_EXIT_WINS, 5),
    enableDynamicWeights: bool(env.ENABLE_DYNAMIC_SIGNAL_WEIGHTING, true),
    signalWeightSet: parseSignalWeightSet(env.SIGNAL_WEIGHT_SET),
    initialWeights,
    winAmplify: num(env.WIN_SIGNAL_AMPLIFY_FACTOR, 1.15),
    lossDampen: num(env.LOSS_SIGNAL_DAMPEN_FACTOR, 0.85),
    minSignalWeight: num(env.MIN_SIGNAL_WEIGHT, 0.02),
    riskPerTradePct: num(env.RISK_PER_TRADE_PERCENTAGE, 2),
    maxTotalExposurePct: num(rawEnv.MAX_TOTAL_EXPOSURE_PERCENTAGE, 60),
    equityProtectionLevel: num(env.EQUITY_PROTECTION_LEVEL, 10000),
    minTradeUsd: num(env.MIN_TRADE_USD, 10),
    mcapPreset,
    minMarketCap: num(env.MIN_MARKET_CAP, MCAP_PRESETS[mcapPreset].min),
    maxMarketCap: num(env.MAX_MARKET_CAP, MCAP_PRESETS[mcapPreset].max),
    minVolumeMcapRatio: num(env.MIN_VOLUME_MCAP_RATIO, 0.2),
    enablePresetLab: bool(env.ENABLE_PRESET_LAB, true),
    // Fixed: USD (not "SOL"), per-token 24h volume floor. Level MIN_VOLUME_USD acts as a lower bound too.
    minVolume24hUsd: Math.max(num(env.MIN_MARKET_VOLUME_24H, 10000), num(env.MIN_VOLUME_USD, num(env[`${aggression}_MIN_VOLUME_USD`], L.minVolumeUsd))),
    // Spec signal rules: volume spike = 5m volume > 5% of mcap; breakout = >5% price rise in 5m; buy pressure = buys > 70% of 5m txns.
    volumeSpikeMcapPct: num(env.VOLUME_SPIKE_5M_MCAP_PCT, 5),
    breakout5mPct: num(env.BREAKOUT_5M_PRICE_PCT, 5),
    buyPressureRatio: num(env.BUY_PRESSURE_RATIO, 0.7),
    minLiquidityUsd: num(env.MIN_LIQUIDITY_USD, 50000),
    nanoCapMax: num(env.NANO_CAP_MAX_USD, 100000),
    minTokenAgeHours: num(env.MIN_TOKEN_AGE_HOURS, 6),
    maxHolderConcentration: num(env.MAX_HOLDER_CONCENTRATION, 0.3),
    maxHourlyPriceMovement: num(env.MAX_HOURLY_PRICE_MOVEMENT, 50),
    requireLiquidityLock: bool(env.REQUIRE_LIQUIDITY_LOCK, true),
    minLpLockedPct: num(env.MIN_LP_LOCKED_PCT, 80),
    scanTopN: num(env.SCAN_TOP_N, 25),
    auditTopN: num(env.AUDIT_TOP_N, 6),
    maxAuditRiskScore: num(env.MAX_AUDIT_RISK_SCORE, 69),
    rugcheckApiKey: env.RUGCHECK_API_KEY && !env.RUGCHECK_API_KEY.startsWith('your_') ? env.RUGCHECK_API_KEY : null,
    maxSellPriceImpactPct: num(env.MAX_SELL_PRICE_IMPACT_PCT, 25),
    txConfirmationTimeoutSec: num(env.TX_CONFIRMATION_TIMEOUT, 30),
    txRetryCount: num(env.TX_RETRY_COUNT, 3),
    priorityFeeEscalation: num(env.PRIORITY_FEE_ESCALATION_FACTOR, 1.5),
    maxPriorityFeeLamports: num(env.MAX_PRIORITY_FEE_LAMPORTS, 2_000_000),
    slippageWidenStepBps: num(env.SLIPPAGE_WIDEN_STEP_BPS, 100),
    maxSlippageBps: num(env.MAX_SLIPPAGE_BPS, Math.max(Math.round(slippageTolerance * 10000) * 2, 300)),
    maxConsecutiveFailures: num(env.MAX_CONSECUTIVE_FAILURES, 3),
    failurePauseMinutes: num(env.FAILURE_PAUSE_MINUTES, 15),
    jupiterApiKey: env.JUPITER_API_KEY && !env.JUPITER_API_KEY.startsWith('your_') ? env.JUPITER_API_KEY : null,
    jupiterBaseUrl: str(env.JUPITER_SWAP_BASE, 'https://api.jup.ag/swap/v2'), // Swap API V2 (/order + /execute); see src/lib/jupiter.ts
    operatorFeeWallet: resolveOperatorFeeWallet(env),
    operatorFeeBps: (() => { const n = num(env.OPERATOR_FEE_BPS, 50); if (n <= 0) return 0; return Math.min(255, Math.max(50, Math.round(n))); })(),
    operatorReferralAccount: (env.JUPITER_REFERRAL_ACCOUNT || env.OPERATOR_REFERRAL_ACCOUNT || '').trim() || null,
    operatorFeeOnOwner: bool(env.OPERATOR_FEE_ON_OWNER, false),
    rpcUrl: str(env.HELIUS_RPC_URL && !env.HELIUS_RPC_URL.includes('your_') ? env.HELIUS_RPC_URL : env.RPC_URL, 'https://api.mainnet-beta.solana.com'),
    secMaxVolumeShare: num(env.SEC_MAX_VOLUME_SHARE, 0.05),
    secMaxLiquidityShare: num(env.SEC_MAX_LIQUIDITY_SHARE, 0.02), // max position = 2% of pool liquidity
    secWashTradeWindowMin: num(env.SEC_WASH_TRADE_WINDOW_MINUTES, 60),
    secMaxTradesPer5Min: num(env.SEC_MAX_TRADES_PER_5MIN, 8),
    simStartingBalanceUsd: num(env.SIM_STARTING_BALANCE_USD, 10000),
    simFeeBps: num(env.SIM_FEE_BPS, 30),
    solPriceFallbackUsd: num(env.SEC_DEFAULT_SOL_PRICE_USD, 180),
    enableAiBrain: bool(env.ENABLE_AI_BRAIN, true),
    geminiModel: str(env.GEMINI_MODEL, 'gemini-2.5-flash'),
    hasGeminiKey: Boolean(env.GEMINI_API_KEY && !env.GEMINI_API_KEY.startsWith('AIzaSyDxxx') && !env.GEMINI_API_KEY.startsWith('your_')),
    enableKillSwitch: bool(env.ENABLE_KILL_SWITCH, true),
    maxDailyLossPct: num(env.MAX_DAILY_LOSS_PCT, 5),
    maxPositionPctOfEquity: num(env.MAX_POSITION_PCT_OF_EQUITY, 5),
    maxConsecutiveLosses: num(env.MAX_CONSECUTIVE_LOSSES, 4),
    tpLadder: parseTpLadder(str(env.PARTIAL_TAKE_PROFITS, '10:33,18:50')),
    stalePositionMinutes: num(env.STALE_POSITION_MINUTES, 45),
    staleBandPct: num(env.STALE_BAND_PCT, 2),
    maxTop10HolderPct: num(env.MAX_TOP10_HOLDER_PCT, 30),
    devSellCheck: bool(env.DEV_SELL_CHECK, true),
    blockIfDevExited: bool(env.BLOCK_IF_DEV_EXITED, false),
    devExitLookbackHours: num(env.DEV_EXIT_LOOKBACK_HOURS, 24),
    submissionMode: parseSubmissionMode(env.SWAP_SUBMISSION_MODE),
    privateRpcUrl: env.PRIVATE_RPC_URL && !env.PRIVATE_RPC_URL.includes('your_') ? env.PRIVATE_RPC_URL : null,
    jitoBlockEngineUrl: str(env.JITO_BLOCK_ENGINE_URL, 'https://mainnet.block-engine.jito.wtf'),
    jitoTipLamports: num(env.JITO_TIP_LAMPORTS, 10000),
    ownerPlan: parseOwnerPlanConfig(env),
  };
}

let cached: Config | null = null;
export function getConfig(): Config {
  if (!cached) cached = buildConfig(process.env);
  return cached;
}

/** Config safe to send to the browser (no secrets; there are none in Config, but keep it explicit). */
export function publicConfig(c: Config = getConfig()) {
  const { rugcheckApiKey, jupiterApiKey, rpcUrl, privateRpcUrl, ...rest } = c;
  return { ...rest, hasPrivateRpc: Boolean(privateRpcUrl), hasRugcheckKey: Boolean(rugcheckApiKey), hasJupiterKey: Boolean(jupiterApiKey), rpc: rpcUrl.includes('helius') ? 'helius' : 'public' };
}

/** Is the bot allowed to open new trades right now per the operating schedule? */
export function isWithinSchedule(c: Pick<Config, 'enable247' | 'startTime' | 'endTime' | 'tradingDays' | 'timezone' | 'pauseOnWeekends'>, now: Date = new Date()): boolean {
  if (c.enable247) return true;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: c.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dayIdx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')); // 0=Monday
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  if (c.pauseOnWeekends && dayIdx >= 5) return false;
  if (!c.tradingDays.includes(dayIdx)) return false;
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
  const start = toMin(c.startTime), end = toMin(c.endTime);
  return start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end; // overnight windows
}


/** Apply the owner's locked money-plan overrides to the operator account only. */
export function applyOwnerPlan<T extends Config>(c: T, isOperator: boolean): T {
  if (!isOperator || !c.ownerPlan.enabled) return c;
  const o = c.ownerPlan;
  return {
    ...c,
    maxOpenPositions: o.maxOpenPositions,
    maxDailyLossPct: o.maxDailyLossPct,
    stopLossPct: o.stopLossPct,
    takeProfitPct: o.takeProfitPct,
    tpLadder: o.tpLadder,
    breakEvenTriggerPct: o.breakEvenTriggerPct ?? c.breakEvenTriggerPct,
    trailingArmPct: o.trailingArmPct ?? c.trailingArmPct,
    trailingStopPct: o.trailingStopPct ?? c.trailingStopPct,
    ...(o.trailingStopPct !== null ? { enableTrailingStop: true } : {}),
    minTradeUsd: Math.min(c.minTradeUsd, o.minTradeUsd),
    maxPositionPctOfEquity: 0,
    equityProtectionLevel: 0,
    mcapPreset: o.mcapPreset,
    minMarketCap: c.mcapPreset === o.mcapPreset ? c.minMarketCap : MCAP_PRESETS[o.mcapPreset].min,
    maxMarketCap: c.mcapPreset === o.mcapPreset ? c.maxMarketCap : MCAP_PRESETS[o.mcapPreset].max,
  };
}
