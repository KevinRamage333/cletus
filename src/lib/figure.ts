export type FigureState = 'value' | 'zero' | 'unavailable';
export type ScreenState = 'loading' | 'empty' | 'ready' | 'stale' | 'error';

/** Missing, blank, and non-numeric values stay missing. A real zero stays zero. */
export function parseFigure(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function moneyText(value: number | null, signed = false): { text: string; state: FigureState } {
  if (value === null) return { text: 'Unavailable', state: 'unavailable' };
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  if (value === 0) return { text: signed ? '+$0.00' : '$0.00', state: 'zero' };
  const sign = value < 0 ? '-' : signed ? '+' : '';
  return { text: `${sign}${formatted}`, state: 'value' };
}

export function screenState(input: {
  loading: boolean;
  error: string | null;
  hasData: boolean;
  empty: boolean;
  refreshedAt?: string | null;
  now?: number;
  staleMs?: number;
}): ScreenState {
  if (!input.hasData && input.loading) return 'loading';
  if (!input.hasData && input.error) return 'error';
  if (input.hasData && input.error) return 'stale';
  if (input.refreshedAt) {
    const age = (input.now ?? Date.now()) - new Date(input.refreshedAt).getTime();
    if (Number.isFinite(age) && age > (input.staleMs ?? 45_000)) return 'stale';
  }
  if (input.empty) return 'empty';
  return 'ready';
}

export function refreshedLabel(kind: string, at: string | null): string {
  if (!at) return `${kind} has not refreshed`;
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return `${kind} has not refreshed`;
  return `${kind} refreshed ${when.toLocaleString()}`;
}
