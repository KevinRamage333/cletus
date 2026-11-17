type DayBar = { source: 'Massive'; symbol: string; sessionStart: string; open: number; high: number; low: number; close: number; volume: number; splitAdjusted: boolean };

export function parseMassiveDayBar(payload: unknown, symbol: string, now = Date.now()): DayBar | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  if (data.status !== 'OK' || data.ticker !== symbol || typeof data.adjusted !== 'boolean'
    || !Array.isArray(data.results) || data.results.length !== 1) return null;
  const row = data.results[0] as Record<string, unknown> | null;
  if (!row || typeof row !== 'object' || row.T !== symbol) return null;
  const { o, h, l, c, v, t } = row;
  if (typeof o !== 'number' || typeof h !== 'number' || typeof l !== 'number' || typeof c !== 'number'
    || typeof v !== 'number' || typeof t !== 'number' || ![o, h, l, c, v, t].every(Number.isFinite)
    || l <= 0 || v < 0 || t <= 0 || t > now || l > Math.min(o, c) || h < Math.max(o, c)) return null;
  return { source: 'Massive', symbol, sessionStart: new Date(t).toISOString(),
    open: o, high: h, low: l, close: c, volume: v, splitAdjusted: data.adjusted };
}

export async function readMassivePreviousSession(symbolInput: unknown, key = process.env.MASSIVE_API_KEY) {
  const symbol = typeof symbolInput === 'string' ? symbolInput.trim().toUpperCase() : '';
  if (!/^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol)) return { status: 'invalid_symbol' as const };
  if (!key?.trim()) return { status: 'not_configured' as const };
  try {
    const response = await fetch(`https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true`, {
      headers: { Authorization: `Bearer ${key.trim()}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(4_000),
      cache: 'no-store',
    });
    if (response.ok) {
      const bar = parseMassiveDayBar(await response.json(), symbol);
      if (bar) return { status: 'ok' as const, bar, scope: 'Historical U.S. equities previous trading session' };
    }
  } catch {
    // Keep raw upstream failures and configuration out of the response.
  }
  return { status: 'unavailable' as const };
}
