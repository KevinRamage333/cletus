export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { startEngine } = await import('./lib/engine');
    startEngine().catch((e) => console.error('[cletus] engine failed to start', e?.message));
  }
}
