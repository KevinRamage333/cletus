import { expect, it, vi } from 'vitest';
import { parseMassiveDayBar, readMassivePreviousSession } from '@/lib/massive-market-data';

const t = 1_700_000_000_000;
const payload = { status: 'OK', ticker: 'SPY', adjusted: true, results: [{ T: 'SPY', o: 10, h: 12, l: 9, c: 11, v: 100, t }] };

it('accepts only a valid previous-session bar for the exact requested ticker', () => {
  expect(parseMassiveDayBar(payload, 'SPY', t + 1)).toMatchObject({ close: 11, volume: 100, splitAdjusted: true });
  expect(parseMassiveDayBar(payload, 'QQQ', t + 1)).toBeNull();
  expect(parseMassiveDayBar(payload, 'SPY', t - 1)).toBeNull();
  expect(parseMassiveDayBar({ ...payload, results: [{ ...payload.results[0], h: 10 }] }, 'SPY', t + 1)).toBeNull();
});

it('uses server authorization and returns a generic status on an upstream error', async () => {
  const fetchStub = vi.fn(async () => new Response('sensitive provider message', { status: 403 }));
  vi.stubGlobal('fetch', fetchStub);
  try {
    await expect(readMassivePreviousSession('spy', '')).resolves.toEqual({ status: 'not_configured' });
    expect(fetchStub).not.toHaveBeenCalled();
    await expect(readMassivePreviousSession('spy', 'test-key')).resolves.toEqual({ status: 'unavailable' });
    expect(fetchStub).toHaveBeenCalledWith('https://api.massive.com/v2/aggs/ticker/SPY/prev?adjusted=true', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-key' }) }));
  } finally {
    vi.unstubAllGlobals();
  }
});
