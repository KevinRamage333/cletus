export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build' && process.env.CLETUS_DEMO !== '1' && process.env.CLETUS_DEMO !== 'true') {
    const { startEngine } = await import('./lib/engine');
    startEngine().catch((e) => console.error('[cletus] engine failed to start', e?.message));
    const { startCollector } = await import('./lib/market-data');
    startCollector();
  }
}
