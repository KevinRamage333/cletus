import { describe, expect, it } from 'vitest';
import {
  applyBaseGasBuffer,
  calculateBaseMaxL2FeeWei,
  parseBaseDecimalUnits,
} from '@/lib/base-complete-fee-estimator';

describe('Base complete fee estimator primitives', () => {
  it('parses decimal token amounts without floating-point rounding', () => {
    expect(parseBaseDecimalUnits('1.000001', 6)).toBe(1_000_001n);
    expect(parseBaseDecimalUnits('0.000000000000000001', 18)).toBe(1n);
  });

  it('rejects invalid decimal precision and non-positive amounts', () => {
    expect(() => parseBaseDecimalUnits('1.0000001', 6)).toThrow('decimal places');
    expect(() => parseBaseDecimalUnits('0', 6)).toThrow('greater than zero');
    expect(() => parseBaseDecimalUnits('-1', 6)).toThrow('positive decimal');
    expect(() => parseBaseDecimalUnits('1', 37)).toThrow('decimals');
  });

  it('adds a ceiling-rounded 20 percent gas safety buffer', () => {
    expect(applyBaseGasBuffer(21_000n)).toBe(25_200n);
    expect(applyBaseGasBuffer(1n)).toBe(2n);
    expect(() => applyBaseGasBuffer(0n)).toThrow('greater than zero');
  });

  it('calculates the conservative maximum L2 fee in wei', () => {
    expect(calculateBaseMaxL2FeeWei(25_200n, 2_000_000_000n)).toBe(50_400_000_000_000n);
    expect(() => calculateBaseMaxL2FeeWei(0n, 1n)).toThrow('positive');
  });
});
