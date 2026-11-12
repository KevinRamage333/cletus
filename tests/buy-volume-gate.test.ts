import { describe, it, expect } from 'vitest';
import { buyVolumeGateConfig, buyVolumeThresholdUsd, estimateBuyVolume10m, DEFAULT_MIN_BUY_VOL_USD } from '@/lib/buy-volume-gate';

const cfg = { minUsd: 10_000, mcapPct: 5 };

describe('buy-volume 10m gate', () => {
  it('threshold is min($10k, 5% of mcap); missing mcap uses $10k; 0 disables', () => {
    expect(buyVolumeThresholdUsd(1_000_000, cfg)).toBe(10_000); // 5% = $50k, min is $10k
    expect(buyVolumeThresholdUsd(100_000, cfg)).toBe(5_000);    // 5% = $5k, lower
    expect(buyVolumeThresholdUsd(null, cfg)).toBe(10_000);
    expect(buyVolumeGateConfig({})!.minUsd).toBe(DEFAULT_MIN_BUY_VOL_USD);
    expect(buyVolumeGateConfig({ MIN_BUY_VOLUME_10M_USD: '0' })).toBeNull();
    expect(buyVolumeGateConfig({ MIN_BUY_VOLUME_10M_USD: '10000', MIN_BUY_VOLUME_10M_MCAP_PCT: '5' })).toEqual(cfg);
  });

  it('uses two 5m candles × buy share from txns when candles exist, else DexScreener m5×2 × share', () => {
    const candles = estimateBuyVolume10m({
      m5VolUsd: 1_000, m5Buys: 80, m5Sells: 20, marketCapUsd: 1_000_000,
      candles5m: [{ volume: 8_000 }, { volume: 7_000 }],
    }, cfg);
    expect(candles.totalVol10mUsd).toBe(15_000);
    expect(candles.buyShare).toBeCloseTo(0.8);
    expect(candles.buyVol10mUsd).toBeCloseTo(12_000);
    expect(candles.source).toBe('candles5m_x2_tx_share');
    expect(candles.pass).toBe(true);

    const dex = estimateBuyVolume10m({ m5VolUsd: 4_000, m5Buys: 3, m5Sells: 1, marketCapUsd: 80_000 }, cfg);
    // threshold = min(10000, 5% of 80k=4000) = 4000; 10m total 8000 * 0.75 = 6000 >= 4000
    expect(dex.source).toBe('dex_m5_x2_tx_share');
    expect(dex.thresholdUsd).toBe(4_000);
    expect(dex.buyVol10mUsd).toBe(6_000);
    expect(dex.pass).toBe(true);
  });

  it('skips with buy vol 10m $X < $Y when under the min() threshold; no txn counts uses total volume', () => {
    const ev = estimateBuyVolume10m({ m5VolUsd: 1_000, m5Buys: 10, m5Sells: 90, marketCapUsd: 1_000_000 }, cfg);
    // 10m total $2k * 10% buy share = $200 < $10k
    expect(ev.pass).toBe(false);
    expect(ev.reason).toBe('buy vol 10m $200 < $10,000');
    const noTx = estimateBuyVolume10m({ m5VolUsd: 6_000, marketCapUsd: 50_000 }, cfg);
    // threshold min(10k, 5% of 50k=2.5k)=2500; total 12k (no share) passes
    expect(noTx.source).toBe('dex_m5_x2_total');
    expect(noTx.pass).toBe(true);
    const failMcap = estimateBuyVolume10m({ m5VolUsd: 200, m5Buys: 1, m5Sells: 1, marketCapUsd: 40_000 }, cfg);
    // threshold min(10k, 2000)=2000; buy 200*2*0.5=200
    expect(failMcap.thresholdUsd).toBe(2_000);
    expect(failMcap.reason).toBe('buy vol 10m $200 < $2,000');
  });
});
