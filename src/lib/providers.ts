/** Brain provider selection (pure; unit-tested). Order: BRAIN_PROVIDER first, then the rest, mock last. */
export type Provider = 'xai' | 'gemini' | 'mock';

export function providerOrder(env: { BRAIN_PROVIDER?: string; hasXaiKey: boolean; hasGeminiKey: boolean; enableAiBrain?: boolean }): Provider[] {
  if (env.enableAiBrain === false) return ['mock'];
  const pref = (env.BRAIN_PROVIDER ?? 'gemini').trim().toLowerCase();
  const base: Provider[] = pref === 'xai' ? ['xai', 'gemini'] : pref === 'mock' ? [] : ['gemini', 'xai'];
  const avail = base.filter((p) => (p === 'xai' ? env.hasXaiKey : env.hasGeminiKey));
  return [...avail, 'mock'];
}

/** Run providers in order until one succeeds; returns the result and the errors from those that failed. */
export async function withFallback<T>(order: Provider[], run: (p: Provider) => Promise<T>): Promise<{ provider: Provider; result: T; errors: Array<{ provider: Provider; error: string }> }> {
  const errors: Array<{ provider: Provider; error: string }> = [];
  for (const p of order) {
    try { return { provider: p, result: await run(p), errors }; }
    catch (e) { errors.push({ provider: p, error: (e as Error).message.slice(0, 200) }); }
  }
  throw new Error(`all Brain providers failed: ${errors.map((e) => `${e.provider}: ${e.error}`).join('; ')}`);
}
