/**
 * Box-only live trading worker. Starts the engine, market-data collector, and
 * flow collectors without the Next.js web server. Env must already request live
 * mode (see scripts/start-live-worker.sh). Does not change .env.local.
 */
/** Forced: what makes this the live owner worker. */
const LIVE_ENV: Record<string, string> = {
  TRADING_MODE: 'live',
  ALLOW_LIVE_IN_BETA: 'true',
  WITHDRAW_LIVE_ENABLED: 'true',
  OWNER_PLAN_ENABLED: 'true',
  MCAP_PRESET: 'BALANCED',
  ENGINE_DISABLED: 'false',
  CLETUS_DEMO: '0',
};
/** Defaults only: exit tuning comes from scripts/start-live-worker.sh when it sets them. */
const LIVE_DEFAULTS: Record<string, string> = {
  OWNER_STOP_LOSS_PCT: '5',
  OWNER_TAKE_PROFIT_PCT: '20',
  OWNER_MAX_OPEN_POSITIONS: '1',
  WHALE_FAST_EXIT: 'on',
  ENABLE_TRAILING_STOP: 'false',
  HOLD_TIME_MINUTES: '10080',
  STALE_POSITION_MINUTES: '0',
};

for (const [k, v] of Object.entries(LIVE_ENV)) process.env[k] = v;
for (const [k, v] of Object.entries(LIVE_DEFAULTS)) if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
process.env.NEXT_RUNTIME ??= 'nodejs';
delete process.env.NEXT_PHASE;

async function main() {
  const { buildConfig } = await import('../src/lib/config');
  const cfg = buildConfig(process.env);
  if (cfg.mode !== 'live') {
    console.error(`[cletus] live worker refused to start: mode=${cfg.mode} reason=${cfg.liveBlockedReason ?? 'unknown'}`);
    process.exit(1);
  }
  // Nightly self-retraining (flags default off): load the promoted weight set + threshold before the first scan.
  const rt = await import('../src/lib/retrain/runtime');
  const { log } = await import('../src/lib/logger');
  const rlog = (level: 'info' | 'warn', msg: string) => log(level, msg).catch(() => console.log(`[cletus] ${msg}`));
  const rf = rt.retrainFlags();
  if (rf.load) {
    if (cfg.signalWeightSet !== 'liquidity') rlog('warn', `RETRAINED_WEIGHTS=on but SIGNAL_WEIGHT_SET=${cfg.signalWeightSet}; the retrained liquidity weights only affect the liquidity set (threshold still applies)`);
    try { rt.applyActiveWeightSet(rlog); } catch (e) { rlog('warn', `retrained weights: load failed (${(e as Error).message}); using the hand-built set`); }
  }
  rlog('info', `retrain flags: RETRAINED_WEIGHTS=${rf.load ? 'on' : 'off'} WEIGHTS_HOT_RELOAD=${rf.hotReload ? 'on' : 'off'} RETRAIN_SCHEDULE=${rf.schedule ? 'on' : 'off'}`);
  try {
    const { pumpAgeFromEnv, describePumpAge } = await import('../src/lib/pump-age');
    const pa = pumpAgeFromEnv(process.env);
    rlog('info', pa ? describePumpAge(pa) : 'pump-age filter: off');
  } catch (e) { rlog('warn', `pump-age flags: failed to read (${(e as Error).message})`); }
  const { startEngine } = await import('../src/lib/engine');
  const { startCollector } = await import('../src/lib/market-data');
  const { startFlowCollectors } = await import('../src/lib/flow-collector');
  await startEngine();
  startCollector();
  startFlowCollectors();
  rt.startRetrainTasks(rlog);
  try { (await import('../src/lib/review-runtime')).startReviewTasks(rlog); } catch (e) { rlog('warn', `journal/review tasks failed to start (${(e as Error).message})`); }
  console.log('[cletus] live worker running (box only; public deploy stays simulation)');
}

main().catch((e) => {
  console.error('[cletus] live worker failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
