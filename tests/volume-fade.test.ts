import { describe, it, expect } from 'vitest';
import { DEFAULT_FADE, boundedFade, fadeReason, stepFade, fadeFromEnv } from '@/lib/volume-fade';

const p = DEFAULT_FADE;
const MIN = 60_000;

describe('volume fade', () => {
  it('defaults are the replay-chosen strict setting', () => {
    expect(p).toMatchObject({ volFrac: 0.1, minutes: 20, maxBuyShare: 0.2, maxGainPct: 15 });
  });
  it('faded when 5m volume is under 10% of the entry level', () => {
    expect(fadeReason({ m5VolUsd: 90 }, 1000, p)).toMatch(/9% of entry level/);
    expect(fadeReason({ m5VolUsd: 150 }, 1000, p)).toBeNull();
  });
  it('sell-side fade needs both few buys and low volume, and enough txns', () => {
    expect(fadeReason({ m5VolUsd: 300, buys: 1, sells: 9 }, 1000, p)).toMatch(/sellers dominate/);
    expect(fadeReason({ m5VolUsd: 800, buys: 1, sells: 9 }, 1000, p)).toBeNull(); // heavy volume: a dump, the stop handles it
    expect(fadeReason({ m5VolUsd: 300, buys: 0, sells: 3 }, 1000, p)).toBeNull();  // too few txns to judge
    expect(fadeReason({ m5VolUsd: 300, buys: 4, sells: 6 }, 1000, p)).toBeNull();
  });
  it('no baseline -> never fades', () => {
    expect(fadeReason({ m5VolUsd: 0 }, 0, p)).toBeNull();
  });
  it('fires only after a continuous fade of the full window', () => {
    const opened = 0;
    let st = { since: null as number | null, reason: null as string | null };
    let r = stepFade(st, 'quiet', 30 * MIN, { openedAt: opened, gainPct: -3 }, p); st = r.st; expect(r.fire).toBe(false);
    r = stepFade(st, 'quiet', 45 * MIN, { openedAt: opened, gainPct: -3 }, p); st = r.st; expect(r.fire).toBe(false);
    r = stepFade(st, null, 46 * MIN, { openedAt: opened, gainPct: -3 }, p); st = r.st; expect(st.since).toBeNull(); // a pause, not a death
    r = stepFade(st, 'quiet', 47 * MIN, { openedAt: opened, gainPct: -3 }, p); st = r.st;
    r = stepFade(st, 'quiet', 66 * MIN, { openedAt: opened, gainPct: -3 }, p); expect(r.fire).toBe(false);
    r = stepFade(r.st, 'quiet', 67 * MIN, { openedAt: opened, gainPct: -3 }, p); expect(r.fire).toBe(true);
  });
  it('leaves a running winner and a fresh entry alone', () => {
    const st = { since: 0, reason: 'quiet' };
    expect(stepFade(st, 'quiet', 25 * MIN, { openedAt: 0, gainPct: 20 }, p).fire).toBe(false);
    expect(stepFade(st, 'quiet', 25 * MIN, { openedAt: 10 * MIN, gainPct: 0 }, p).fire).toBe(false);
  });
  it('env overrides are bounded; off disables', () => {
    expect(fadeFromEnv({ OWNER_VOLUME_FADE: 'off' })).toBeNull();
    expect(fadeFromEnv({ FADE_MINUTES: '3', FADE_VOL_FRAC: '0.9' })).toMatchObject({ minutes: 15, volFrac: 0.5 });
    expect(boundedFade({ minutes: 999 }).minutes).toBe(30);
    expect(fadeFromEnv({})).toEqual(DEFAULT_FADE);
  });
});
