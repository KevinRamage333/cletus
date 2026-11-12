/**
 * Hard 5-minute volume floor (owner rule): a live position whose rolling 5m volume drops below
 * LOW_VOL_5M_EXIT_USD (default $1,500) is sold; a coin below it is never bought. A short grace after entry
 * (LOW_VOL_5M_GRACE_SEC, default 300 s = the first 5m candle) avoids selling on the entry candle.
 * LOW_VOL_5M_EXIT_USD=0 turns it off. Pure and unit-tested.
 */
export interface LowVolConfig { minUsd: number; graceSec: number }

export function lowVolConfig(env: Record<string, string | undefined> = process.env): LowVolConfig | null {
  const raw = env.LOW_VOL_5M_EXIT_USD;
  const minUsd = raw === undefined || raw.trim() === '' ? 1500 : Number(raw);
  if (!Number.isFinite(minUsd) || minUsd <= 0) return null;
  const g = Number(env.LOW_VOL_5M_GRACE_SEC);
  const graceSec = Number.isFinite(g) && g >= 0 && (env.LOW_VOL_5M_GRACE_SEC ?? '').trim() !== '' ? Math.min(g, 1800) : 300;
  return { minUsd, graceSec };
}

/** Entry check: 5m volume must be known and >= the floor. */
export function entryVolumeOk(m5VolUsd: number | null | undefined, cfg: LowVolConfig): { ok: boolean; reason: string | null } {
  if (typeof m5VolUsd !== 'number' || !Number.isFinite(m5VolUsd)) return { ok: false, reason: '5m volume unknown' };
  if (m5VolUsd < cfg.minUsd) return { ok: false, reason: `5m volume $${Math.round(m5VolUsd).toLocaleString('en-US')} < $${cfg.minUsd.toLocaleString('en-US')}` };
  return { ok: true, reason: null };
}

/** Exit check on a fresh flow sample. Returns the reason to sell everything, or null. */
export function lowVolumeExitReason(inp: { m5VolUsd: number | null | undefined; openedAtMs: number; sampleAtMs: number; nowMs: number }, cfg: LowVolConfig, maxSampleAgeMs = 120_000): string | null {
  if (typeof inp.m5VolUsd !== 'number' || !Number.isFinite(inp.m5VolUsd)) return null; // no data: other exits still protect
  if (inp.nowMs - inp.sampleAtMs > maxSampleAgeMs) return null;
  if (inp.sampleAtMs - inp.openedAtMs < cfg.graceSec * 1000) return null;
  if (inp.m5VolUsd >= cfg.minUsd) return null;
  return `5m volume $${Math.round(inp.m5VolUsd).toLocaleString('en-US')} < $${cfg.minUsd.toLocaleString('en-US')}`;
}
