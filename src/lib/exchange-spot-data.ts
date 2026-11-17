type Venue = 'OKX' | 'Bybit';
type Ticker = { venue: Venue; pair: string; last: number; bid: number | null; ask: number | null; asOf: string };
type VenueResult = { venue: Venue; status: 'ok'; ticker: Ticker } | { venue: Venue; status: 'unavailable' };
const BASE_SYMBOL = /^[A-Z0-9]{2,15}$/;
const MAX_AGE_MS = 120_000;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function positive(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseSpotTicker(venue: Venue, payload: unknown, symbol: string, now = Date.now()): Ticker | null {
  const body = record(payload);
  const bybit = record(body.result);
  const list = venue === 'OKX' ? body.data : bybit.list;
  if (venue === 'OKX' ? body.code !== '0' : body.retCode !== 0 || bybit.category !== 'spot') return null;
  if (!Array.isArray(list)) return null;
  const pair = `${symbol}-USDT`;
  const row = list.map(record).find((item) => venue === 'OKX'
    ? item.instId === pair && item.instType === 'SPOT'
    : item.symbol === symbol + 'USDT');
  if (!row) return null;
  const last = positive(venue === 'OKX' ? row.last : row.lastPrice);
  const observed = positive(venue === 'OKX' ? row.ts : body.time);
  if (last === null || observed === null || observed > now + 10_000 || now - observed > MAX_AGE_MS) return null;
  return {
    venue, pair, last,
    bid: positive(venue === 'OKX' ? row.bidPx : row.bid1Price),
    ask: positive(venue === 'OKX' ? row.askPx : row.ask1Price),
    asOf: new Date(observed).toISOString(),
  };
}

async function readVenue(venue: Venue, url: URL, symbol: string): Promise<VenueResult> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(4_000),
      headers: { Accept: 'application/json' },
      next: { revalidate: 20 },
    });
    if (response.ok) {
      const ticker = parseSpotTicker(venue, await response.json(), symbol);
      if (ticker) return { venue, status: 'ok', ticker };
    }
  } catch {
    // Provider outages or regional access restrictions must not invent an observation.
  }
  return { venue, status: 'unavailable' };
}

export async function readExchangeSpot(symbolInput: unknown) {
  const symbol = typeof symbolInput === 'string' ? symbolInput.trim().toUpperCase() : '';
  if (!BASE_SYMBOL.test(symbol) || symbol === 'USDT') return { error: 'Provide a valid base symbol, such as SOL or ETH.' };

  const okx = new URL('https://www.okx.com/api/v5/market/ticker');
  okx.searchParams.set('instId', `${symbol}-USDT`);
  const bybit = new URL('https://api.bybit.com/v5/market/tickers');
  bybit.searchParams.set('category', 'spot');
  bybit.searchParams.set('symbol', symbol + 'USDT');

  return {
    baseSymbol: symbol,
    quoteCurrency: 'USDT',
    venues: await Promise.all([readVenue('OKX', okx, symbol), readVenue('Bybit', bybit, symbol)]),
    scope: 'exchange spot reference only; symbols are not on-chain token identities',
  };
}
