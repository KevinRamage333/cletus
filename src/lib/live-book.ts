/**
 * The owner's funded wallet went live at 12:23 PM CST on 2026-11-11.
 * The default /owner and /live books only include non-simulated trades from
 * that moment forward. Earlier paper/sim closes stay in simulation history.
 */
export const LIVE_BOOK_START_ISO = '2026-11-11T18:23:00.000Z'; // 2026-11-11 12:23 PM America/Chicago
export const LIVE_BOOK_START_MS = Date.parse(LIVE_BOOK_START_ISO);
export const LIVE_EMPTY_MESSAGE = 'Cletus went live today — first trades coming';

export type BookKind = 'live' | 'simulation';

/** Live book: not simulated, and at/after the live start. Everything else is simulation history. */
export function isLiveBookTrade(t: { at?: string | null; closedAt?: string | Date | null; openedAt?: string | null; simulated?: boolean }): boolean {
  if (t.simulated === true) return false;
  const raw = t.at ?? (t.closedAt instanceof Date ? t.closedAt.toISOString() : t.closedAt) ?? t.openedAt;
  const ms = raw ? Date.parse(String(raw)) : NaN;
  return Number.isFinite(ms) && ms >= LIVE_BOOK_START_MS;
}
