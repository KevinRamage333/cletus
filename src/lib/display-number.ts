/**
 * Display helpers that never invent a zero (or "now") when a value is missing.
 * Missing, non-finite, or empty values stay null and render as "—".
 */

export function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatUsd(n: number | null | undefined, showSign = false, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const body = `$${abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  if (!showSign) return n < 0 ? `-${body}` : body;
  return `${n >= 0 ? '+' : '-'}${body}`;
}

export function formatFixed(n: number | null | undefined, digits: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

export function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'text-white/70';
  return n >= 0 ? 'text-emerald-400' : 'text-red-400';
}

/** Sum known numbers. If any entry is missing, the total is unknown (null), except an empty list is 0. */
export function sumKnownOrNull(values: ReadonlyArray<number | null | undefined>): number | null {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) {
    const n = toNumOrNull(v);
    if (n === null) return null;
    sum += n;
  }
  return sum;
}

/**
 * Days left on a trial. Returns null when the server did not provide a start date
 * so the UI can hide the trial instead of inventing "now" as the start.
 */
export function trialDaysRemaining(
  trialStartedAt: string | null | undefined,
  trialDays: number | null | undefined,
  now = Date.now(),
): number | null {
  if (!trialStartedAt) return null;
  const start = Date.parse(trialStartedAt);
  const days = toNumOrNull(trialDays);
  if (!Number.isFinite(start) || days === null || days <= 0) return null;
  const end = start + days * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
}
