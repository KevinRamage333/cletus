import { expect, it } from 'vitest';
import { parseSpotTicker, readExchangeSpot } from '@/lib/exchange-spot-data';

const now = 1_800_000_000_000;
const okx = { code: '0', data: [{ instType: 'SPOT', instId: 'SOL-USDT', last: '141.2', bidPx: '141', askPx: '141.3', ts: String(now) }] };
const bybit = { retCode: 0, time: now, result: { category: 'spot', list: [{ symbol: 'SOLUSDT', lastPrice: '141.3', bid1Price: '', ask1Price: '141.5' }] } };

it('normalizes spot quotes and keeps absent prices and balances out of the result', async () => {
  expect(parseSpotTicker('OKX', okx, 'SOL', now)).toMatchObject({ pair: 'SOL-USDT', last: 141.2, bid: 141 });
  expect(parseSpotTicker('Bybit', bybit, 'SOL', now)).toMatchObject({ pair: 'SOL-USDT', last: 141.3, bid: null });
  expect(await readExchangeSpot('SOL/USDT')).toHaveProperty('error');
});

it('discards stale, wrong-pair, and provider-error responses', () => {
  expect(parseSpotTicker('OKX', okx, 'BTC', now)).toBeNull();
  expect(parseSpotTicker('OKX', okx, 'SOL', now + 120_001)).toBeNull();
  expect(parseSpotTicker('Bybit', { ...bybit, retCode: 10001 }, 'SOL', now)).toBeNull();
  expect(parseSpotTicker('Bybit', { ...bybit, time: undefined }, 'SOL', now)).toBeNull();
});
