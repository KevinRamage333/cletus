import { PrismaClient } from '@prisma/client';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { HttpsProxyAgent } from 'https-proxy-agent';
import ws from 'ws';

/**
 * This box cannot open outbound Postgres :5432 (the egress path only forwards
 * HTTPS). Neon connections therefore go over WebSockets on 443 via the Prisma
 * Neon adapter. Vercel can keep using ordinary TCP if it wants — the adapter
 * also works there without a proxy.
 */
function configureNeonWebSockets() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.NEON_HTTPS_PROXY;
  if (proxy) {
    const agent = new HttpsProxyAgent(proxy);
    neonConfig.webSocketConstructor = class extends ws {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols, { agent });
      }
    } as unknown as typeof neonConfig.webSocketConstructor;
  } else {
    neonConfig.webSocketConstructor = ws as unknown as typeof neonConfig.webSocketConstructor;
  }
}

function makePrisma(): PrismaClient {
  const url = process.env.DATABASE_URL || '';
  if (/[.]neon[.]tech\b/i.test(url)) {
    configureNeonWebSockets();
    const pool = new Pool({ connectionString: url });
    // Driver adapters may ignore ?schema=app; force search_path on every connection.
    pool.on?.('connect', (client: { query: (sql: string) => unknown }) => {
      void client.query('SET search_path TO app, public');
    });
    // Driver adapters default schemaName to `public` unless set here, which made
    // Prisma qualify app tables as public."EngineState" / public."LogEntry"
    // (42501 permission denied for schema public). @@schema("app") is not enough.
    const adapter = new PrismaNeon(pool, { schema: 'app' });
    return new PrismaClient({ adapter, log: ['error'] });
  }
  return new PrismaClient({ log: ['error'] });
}

const g = globalThis as unknown as { __prisma?: PrismaClient };
export const prisma = g.__prisma ?? makePrisma();
if (process.env.NODE_ENV !== 'production') g.__prisma = prisma;
