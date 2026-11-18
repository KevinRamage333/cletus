import { describe, it, expect } from 'vitest';
import {
  toNumOrNull, formatUsd, formatFixed, formatCount, pnlClass, sumKnownOrNull, trialDaysRemaining,
} from '@/lib/display-number';

describe('toNumOrNull', () => {
  it('keeps real zeros and drops missing or invalid values', () => {
    expect(toNumOrNull(0)).toBe(0);
    expect(toNumOrNull('0')).toBe(0);
    expect(toNumOrNull(12.5)).toBe(12.5);
    expect(toNumOrNull('3.25')).toBe(3.25);
    expect(toNumOrNull(null)).toBeNull();
    expect(toNumOrNull(undefined)).toBeNull();
    expect(toNumOrNull('')).toBeNull();
    expect(toNumOrNull('nope')).toBeNull();
    expect(toNumOrNull(Number.NaN)).toBeNull();
    expect(toNumOrNull(Infinity)).toBeNull();
  });
});

describe('formatters render an em dash for missing data, never a fake $0', () => {
  it('formatUsd / formatFixed / formatCount', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
    expect(formatUsd(Number.NaN)).toBe('—');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(12.5, true)).toBe('+$12.50');
    expect(formatUsd(-3, true)).toBe('-$3.00');
    expect(formatFixed(null, 4)).toBe('—');
    expect(formatFixed(1.23456, 4)).toBe('1.2346');
    expect(formatCount(null)).toBe('—');
    expect(formatCount(1200)).toBe('1,200');
  });
  it('pnlClass stays neutral when the value is missing', () => {
    expect(pnlClass(null)).toBe('text-white/70');
    expect(pnlClass(1)).toBe('text-emerald-400');
    expect(pnlClass(-1)).toBe('text-red-400');
  });
  it('sumKnownOrNull does not treat a missing addend as zero', () => {
    expect(sumKnownOrNull([])).toBe(0);
    expect(sumKnownOrNull([1, 2, 3])).toBe(6);
    expect(sumKnownOrNull([1, null, 3])).toBeNull();
    expect(sumKnownOrNull([0])).toBe(0);
  });
});

describe('trialDaysRemaining', () => {
  const start = '2026-11-01T00:00:00.000Z';
  const now = Date.parse('2026-11-11T00:00:00.000Z');
  it('returns remaining days from a server start date', () => {
    expect(trialDaysRemaining(start, 30, now)).toBe(20);
  });
  it('does not invent "now" as the start when the server omitted it', () => {
    expect(trialDaysRemaining(null, 30, now)).toBeNull();
    expect(trialDaysRemaining(undefined, 30, now)).toBeNull();
    expect(trialDaysRemaining('', 30, now)).toBeNull();
    expect(trialDaysRemaining('not-a-date', 30, now)).toBeNull();
  });
});
