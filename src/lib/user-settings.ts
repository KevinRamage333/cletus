/**
 * Per-account (per-user paper account) trading settings from the Config page.
 * Stored as JSON on Account.settings. They override the server config for that account only, and only within the server's
 * hard limits (e.g. positions are still capped by the portfolio/compliance/equity caps).
 */
import { AGGRESSION_LEVELS, type AggressionLevel, type Config } from './config';

export interface AccountSettings {
  tradingHoursEnabled: boolean;
  tradingStart: string; // "HH:MM" local to timezone
  tradingEnd: string;
  activeDays: string[]; // Mon..Sun; entries only on these days when trading hours are enabled
  timezone: string;
  aggression: AggressionLevel | null; // null = server default
  positionSizePct: number | null; // % of equity per new position (null = server sizing)
  stopLossPct: number | null;
  takeProfitPct: number | null;
  dailyProfitTargetUsd: number; // 0 disables; auto-pause when hit
  dailyMaxLossUsd: number; // positive number, 0 disables; auto-pause when today's PnL <= -value
  maxConcurrent: number; // 1..20
  capital: number | null; // starting paper capital applied on Start Simulation / Reset
}

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const CAPITAL_QUICK = [500, 1000, 5000, 10000] as const;
export const LIMITS = {
  positionSizePct: [0.5, 25], stopLossPct: [1, 50], takeProfitPct: [2, 500], maxConcurrent: [1, 20], startingCapital: [100, 1_000_000],
} as const;

export function defaultSettings(c: Pick<Config, 'timezone' | 'maxOpenPositions'>): AccountSettings {
  return {
    tradingHoursEnabled: false, tradingStart: '08:30', tradingEnd: '15:00', activeDays: [...DAYS], timezone: c.timezone || 'America/Chicago',
    aggression: null, positionSizePct: null, stopLossPct: null, takeProfitPct: null,
    dailyProfitTargetUsd: 0, dailyMaxLossUsd: 0, maxConcurrent: Math.min(20, Math.max(1, c.maxOpenPositions || 20)), capital: null,
  };
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const numOrNull = (v: unknown, lim: readonly [number, number]) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? clamp(Number(v), lim) : null);

function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Merge untrusted input over a base, clamping every field into its allowed range. */
export function sanitizeSettings(input: unknown, base: AccountSettings): AccountSettings {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(i, k);
  const out = { ...base };
  if (has('tradingHoursEnabled')) out.tradingHoursEnabled = !!i.tradingHoursEnabled;
  if (has('tradingStart') && typeof i.tradingStart === 'string' && HHMM.test(i.tradingStart)) out.tradingStart = i.tradingStart;
  if (has('tradingEnd') && typeof i.tradingEnd === 'string' && HHMM.test(i.tradingEnd)) out.tradingEnd = i.tradingEnd;
  if (has('timezone') && validTz(i.timezone)) out.timezone = i.timezone;
  if (has('aggression')) out.aggression = typeof i.aggression === 'string' && i.aggression.toUpperCase() in AGGRESSION_LEVELS ? (i.aggression.toUpperCase() as AggressionLevel) : null;
  if (has('positionSizePct')) out.positionSizePct = numOrNull(i.positionSizePct, LIMITS.positionSizePct);
  if (has('stopLossPct')) out.stopLossPct = numOrNull(i.stopLossPct, LIMITS.stopLossPct);
  if (has('takeProfitPct')) out.takeProfitPct = numOrNull(i.takeProfitPct, LIMITS.takeProfitPct);
  if (has('dailyProfitTargetUsd')) out.dailyProfitTargetUsd = Math.max(0, Number(i.dailyProfitTargetUsd) || 0);
  if (has('dailyMaxLossUsd')) out.dailyMaxLossUsd = Math.abs(Number(i.dailyMaxLossUsd) || 0);
  if (has('activeDays') && Array.isArray(i.activeDays)) out.activeDays = DAYS.filter((d) => (i.activeDays as unknown[]).includes(d));
  if (has('capital')) out.capital = i.capital === null || i.capital === '' ? null : Number.isFinite(Number(i.capital)) ? clamp(Number(i.capital), LIMITS.startingCapital) : base.capital;
  if (has('maxConcurrent')) out.maxConcurrent = Math.round(clamp(Number(i.maxConcurrent) || base.maxConcurrent, LIMITS.maxConcurrent));
  return out;
}

export function parseSettings(json: string | null | undefined, c: Pick<Config, 'timezone' | 'maxOpenPositions'>): AccountSettings {
  const base = defaultSettings(c);
  if (!json) return base;
  try { return sanitizeSettings(JSON.parse(json), base); } catch { return base; }
}

/** Effective config for one account: server config with this account's overrides applied. */
export function effectiveConfig(c: Config, s: AccountSettings): Config {
  const out: Config = { ...c };
  if (s.aggression && s.aggression !== c.aggression) {
    const L = AGGRESSION_LEVELS[s.aggression];
    Object.assign(out, { aggression: s.aggression, minCompositeScore: L.minCompositeScore, maxPositionSizeUsd: L.maxPositionSizeUsd, holdTimeMinutes: L.holdTimeMinutes });
  }
  if (s.stopLossPct !== null) out.stopLossPct = s.stopLossPct;
  if (s.takeProfitPct !== null) out.takeProfitPct = s.takeProfitPct;
  out.maxOpenPositions = Math.min(c.maxOpenPositions, s.maxConcurrent);
  return out;
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Are new entries allowed now under this account's trading hours? (Open positions are always managed.) Overnight windows supported. */
export function withinTradingHours(s: AccountSettings, now = new Date()): boolean {
  if (!s.tradingHoursEnabled) return true;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: s.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  if (!s.activeDays.includes(wd)) return false;
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0), m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const t = h * 60 + m, a = minutesOf(s.tradingStart), b = minutesOf(s.tradingEnd);
  if (a === b) return true;
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** Daily profit target / max loss (0 disables). Returns a pause reason when hit. */
export function dailyLimitHit(s: AccountSettings, dayPnlUsd: number): string | null {
  if (s.dailyProfitTargetUsd > 0 && dayPnlUsd >= s.dailyProfitTargetUsd) return `daily profit target reached ($${dayPnlUsd.toFixed(2)} ≥ $${s.dailyProfitTargetUsd})`;
  if (s.dailyMaxLossUsd > 0 && dayPnlUsd <= -s.dailyMaxLossUsd) return `daily max loss hit ($${dayPnlUsd.toFixed(2)} ≤ -$${s.dailyMaxLossUsd})`;
  return null;
}

/** Position size from the "position size %" slider (still subject to every downstream cap). */
export function sizeFromPct(s: AccountSettings, equityUsd: number, serverSizeUsd: number): number {
  return s.positionSizePct === null ? serverSizeUsd : (equityUsd * s.positionSizePct) / 100;
}

export function settingsSummary(s: AccountSettings, c: Config): string[] {
  const e = effectiveConfig(c, s);
  return [
    `Aggression: ${e.aggression}${s.aggression ? '' : ' (server default)'} · min score ${e.minCompositeScore}`,
    `Position size: ${s.positionSizePct !== null ? `${s.positionSizePct}% of equity` : 'server sizing (risk-based tiers)'} · capped at ${c.maxPositionPctOfEquity}% of equity and ${(c.secMaxLiquidityShare * 100).toFixed(0)}% of pool`,
    `Stop loss ${e.stopLossPct}% · take profit ${e.takeProfitPct}%${c.enableTrailingStop ? ` · trailing ${c.trailingStopPct}%` : ''}`,
    `Daily profit target: ${s.dailyProfitTargetUsd > 0 ? `$${s.dailyProfitTargetUsd}` : 'off'} · daily max loss: ${s.dailyMaxLossUsd > 0 ? `$${s.dailyMaxLossUsd}` : 'off'} (auto-pause)`,
    `Max concurrent positions: ${e.maxOpenPositions}`,
    `Trading hours: ${s.tradingHoursEnabled ? `${s.tradingStart}–${s.tradingEnd} ${s.timezone} (new entries only; open positions keep running)` : 'any time the engine schedule allows'}`,
  ];
}

/** "9:00 AM" / "21:30" → "HH:MM" (24h); null if unparseable. */
export function to24h(t: unknown): string | null {
  if (typeof t !== 'string') return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2]);
  if (m[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0); }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
/** "21:30" → "9:30 PM" */
export function to12h(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2)), m = hhmm.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}
export const UI_AGGRESSION: Record<string, AggressionLevel> = { conservative: 'CONSERVATIVE', moderate: 'MODERATE', aggressive: 'AGGRESSIVE', max: 'MAXIMUM' };
export const AGGRESSION_UI: Record<AggressionLevel, string> = { CONSERVATIVE: 'conservative', MODERATE: 'moderate', AGGRESSIVE: 'aggressive', MAXIMUM: 'max' };

/** Map the Config page's POST body (saved frontend field names) onto AccountSettings input. */
export function fromConfigPage(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('capital' in b) out.capital = b.capital;
  if ('activeDays' in b) out.activeDays = b.activeDays;
  const st = to24h(b.startTime), en = to24h(b.endTime);
  if (st) out.tradingStart = st;
  if (en) out.tradingEnd = en;
  if ('tradingHoursEnabled' in b) out.tradingHoursEnabled = b.tradingHoursEnabled;
  else if (st || en) out.tradingHoursEnabled = true;
  if ('timezone' in b) out.timezone = b.timezone;
  if (typeof b.aggression === 'string') out.aggression = UI_AGGRESSION[b.aggression.toLowerCase()] ?? b.aggression;
  if ('positionSizePercent' in b) out.positionSizePct = b.positionSizePercent;
  if ('stopLossPercent' in b) out.stopLossPct = b.stopLossPercent;
  if ('takeProfitPercent' in b) out.takeProfitPct = b.takeProfitPercent;
  if ('dailyProfitTarget' in b) out.dailyProfitTargetUsd = b.dailyProfitTarget;
  if ('dailyMaxLoss' in b) out.dailyMaxLossUsd = b.dailyMaxLoss;
  if ('maxPositions' in b) out.maxConcurrent = b.maxPositions;
  return out;
}
