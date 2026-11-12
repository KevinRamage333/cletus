import { describe, it, expect } from 'vitest';
import { scalpConfig, scalpEntryCheck, scalpTimeStop } from '@/lib/momentum-scalp';

describe('momentum scalp (dryrun)', () => {
  it('is off by default and on is forced to dryrun', () => {
    expect(scalpConfig({}).mode).toBe('off');
    expect(scalpConfig({ MOMENTUM_SCALP: 'on' }).mode).toBe('dryrun');
    expect(scalpConfig({ MOMENTUM_SCALP: 'dryrun' }).stopLossPct).toBe(8);
  });
  it('needs buyers > sellers, rising 5m volume >= $5k', () => {
    const c = scalpConfig({ MOMENTUM_SCALP: 'dryrun' });
    const ok = scalpEntryCheck({ buys5m: 70, sells5m: 30, candles5m: [{ volume: 4000 }, { volume: 6000, open: 1, close: 1.2, high: 1.25, low: 0.98 }] }, c);
    expect(ok.pass).toBe(true);
    expect(scalpEntryCheck({ buys5m: 40, sells5m: 60, candles5m: [{ volume: 4000 }, { volume: 6000 }] }, c).pass).toBe(false);
    expect(scalpEntryCheck({ buys5m: 70, sells5m: 30, candles5m: [{ volume: 7000 }, { volume: 6000 }] }, c).reasons.join()).toMatch(/not rising/);
    expect(scalpEntryCheck({ buys5m: 70, sells5m: 30, candles5m: [{ volume: 1000 }, { volume: 3000 }] }, c).reasons.join()).toMatch(/< \$5000/);
  });
  it('time stop after 12 min unless up 3%', () => {
    const c = scalpConfig({ MOMENTUM_SCALP: 'dryrun' });
    expect(scalpTimeStop(0, 11 * 60_000, 0, 0, c)).toBe(false);
    expect(scalpTimeStop(0, 12 * 60_000, 2.9, 0, c)).toBe(true);
    expect(scalpTimeStop(0, 12 * 60_000, 3.1, 0, c)).toBe(false);
    expect(scalpTimeStop(0, 20 * 60_000, 0, 1, c)).toBe(false);
  });
});
