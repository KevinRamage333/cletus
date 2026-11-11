/** Public demo mode (Vercel). No database, no wallet, no engine: landing, legal, disclaimer, live charts and a
 *  Brain demo only. Account features show "coming online soon". Enabled with CLETUS_DEMO=1. */
export const isDemo = (env: Record<string, string | undefined> = process.env) => env.CLETUS_DEMO === '1' || env.CLETUS_DEMO === 'true';
