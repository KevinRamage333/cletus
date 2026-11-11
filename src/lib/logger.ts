import { prisma } from './db';
import { redactSecrets } from './redact';

export type Level = 'debug' | 'info' | 'warn' | 'error' | 'trade';

export async function log(level: Level, message: string, accountId?: string | null) {
  const msg = redactSecrets(message).slice(0, 2000);
  const line = `[cletus] ${new Date().toISOString()} ${level.toUpperCase()} ${msg}`;
  if (level === 'error') console.error(line); else if (level !== 'debug') console.log(line);
  try {
    await prisma.logEntry.create({ data: { level, message: msg, accountId: accountId ?? null } });
  } catch {
    /* logging must never crash the engine */
  }
}
