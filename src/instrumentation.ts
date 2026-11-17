export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build' && process.env.CLETUS_DEMO !== '1' && process.env.CLETUS_DEMO !== 'true') {
    // Cron and in-process timers must never drive the same engine.
    if (process.env.CLETUS_ENGINE_TRANSPORT === 'cron') {
      console.info('[cletus] cron-driven engine mode; in-process intervals disabled');
      return;
    }
    const { startEngine } = await import('./lib/engine');
    startEngine().catch((e) => console.error('[cletus] engine failed to start', e?.message));
    const { startCollector } = await import('./lib/market-data');
    startCollector();
    const { startFlowCollectors } = await import('./lib/flow-collector');
    startFlowCollectors();
  }
}
