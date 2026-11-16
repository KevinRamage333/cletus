import { describe, it, expect } from 'vitest';
import { assertLiveTradingAcknowledged, LIVE_TRADING_ACK } from '@/lib/live-guard';

describe('live execution acknowledgement guard', () => {
  it('blocks live execution when no explicit acknowledgement is supplied', () => {
    expect(() => assertLiveTradingAcknowledged({})).toThrow(/Live execution blocked/);
    expect(() => assertLiveTradingAcknowledged({ CLETUS_LIVE_TRADING_ACK: 'true' })).toThrow(/Live execution blocked/);
  });

  it('allows the exact explicit acknowledgement', () => {
    expect(() => assertLiveTradingAcknowledged({ CLETUS_LIVE_TRADING_ACK: LIVE_TRADING_ACK })).not.toThrow();
  });
});
