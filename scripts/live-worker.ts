/**
 * Box-only live trading worker. Starts the engine, market-data collector, and
 * flow collectors without the Next.js web server. Env must already request live
 * mode (see scripts/start-live-worker.sh). Does not change .env.local.
 */
const LIVE_ENV: Record<string, string> = {
  TRADING_MODE: 'live',
  ALLOW_LIVE_IN_BETA: 'true',
  WITHDRAW_LIVE_ENABLED: 'true',
  OWNER_PLAN_ENABLED: 'true',
  MCAP_PRESET: 'BALANCED',
  OWNER_STOP_LOSS_PCT: '5',
  OWNER_TAKE_PROFIT_PCT: '20',
  OWNER_MAX_OPEN_POSITIONS: '1',
  WHALE_FAST_EXIT: 'on',
  ENABLE_TRAILING_STOP: 'false',
  HOLD_TIME_MINUTES: '10080',
  STALE_POSITION_MINUTES: '0',
  ENGINE_DISABLED: 'false',
  CLETUS_DEMO: '0',
};

for (const [k, v] of Object.entries(LIVE_ENV)) process.env[k] = v;
process.env.NEXT_RUNTIME ??= 'nodejs';
delete process.env.NEXT_PHASE;

async function main() {
  const { buildConfig } = await import('../src/lib/config');
  const cfg = buildConfig(process.env);
  if (cfg.mode !== 'live') {
    console.error(`[cletus] live worker refused to start: mode=${cfg.mode} reason=${cfg.liveBlockedReason ?? 'unknown'}`);
    process.exit(1);
  }
  const { startEngine } = await import('../src/lib/engine');
  const { startCollector } = await import('../src/lib/market-data');
  const { startFlowCollectors } = await import('../src/lib/flow-collector');
  await startEngine();
  startCollector();
  startFlowCollectors();
  console.log('[cletus] live worker running (box only; public deploy stays simulation)');
}

main().catch((e) => {
  console.error('[cletus] live worker failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
