'use client';

import { moneyText, type ScreenState } from '@/lib/figure';

const COPY: Record<ScreenState, string | null> = {
  loading: 'Loading…',
  empty: 'Nothing recorded yet.',
  ready: null,
  stale: 'Showing the last refresh. Newer data is unavailable.',
  error: 'This screen could not be loaded.',
};

export function ScreenStatus({
  state,
  error,
  refreshedLabel,
  emptyLabel,
}: {
  state: ScreenState;
  error?: string | null;
  refreshedLabel?: string;
  emptyLabel?: string;
}) {
  const message = state === 'error' ? (error || COPY.error) : state === 'empty' ? (emptyLabel || COPY.empty) : COPY[state];
  if (!message && !refreshedLabel) return null;
  return (
    <div data-testid="screen-status" data-state={state} role={state === 'error' ? 'alert' : 'status'} className="rounded-2xl border border-white/10 bg-[#121212] px-4 py-3 text-sm text-white/70">
      {message && <p className={state === 'error' ? 'text-red-300' : state === 'stale' ? 'text-amber-200' : ''}>{message}</p>}
      {refreshedLabel && <p className="text-[11px] text-white/40 mt-1" data-testid="refreshed-at">{refreshedLabel}</p>}
    </div>
  );
}

export function Money({
  value,
  signed = false,
  className = '',
}: {
  value: number | null;
  signed?: boolean;
  className?: string;
}) {
  const figure = moneyText(value, signed);
  const tone = figure.state === 'unavailable'
    ? 'text-white/35 italic'
    : figure.state === 'zero'
      ? 'text-white/70'
      : value !== null && value < 0
        ? 'text-red-400'
        : 'text-emerald-400';
  return <span data-figure={figure.state} className={`${tone} ${className}`.trim()}>{figure.text}</span>;
}
