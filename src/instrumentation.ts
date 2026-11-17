export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build' && process.env.CLETUS_DEMO !== '1' && process.env.CLETUS_DEMO !== 'true') {
    // On Vercel, use the authenticated Cron route rather than relying on
    // setInterval timers inside a serverless function that can be frozen.
    if (process.env.VERCEL === '1' && process.env.CLETUS_ENGINE_TRANSPORT === 'cron') {
      console.info('[cletus] Vercel cron-driven engine mode; in-process intervals disabled');
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
