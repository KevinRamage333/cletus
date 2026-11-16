import { describe, expect, it } from 'vitest';
import { encodeGetL1FeeCall } from '@/lib/base-gas-oracle';

describe('Base GasPriceOracle ABI encoding', () => {
  it('encodes getL1Fee(bytes) with the correct selector, offset, length and padding', () => {
    const data = encodeGetL1FeeCall('0xc0');
    expect(data.slice(0, 10)).toBe('0x939e1e40');
    expect(data.slice(10, 74)).toBe('0'.repeat(62) + '20');
    expect(data.slice(74, 138)).toBe('0'.repeat(63) + '1');
    expect(data.slice(138)).toBe('c0' + '0'.repeat(62));
    expect(data).toHaveLength(10 + 64 * 3);
  });

  it('supports multiple RLP bytes and pads only to a 32-byte boundary', () => {
    const data = encodeGetL1FeeCall('0x' + 'ab'.repeat(33));
    expect(data.slice(74, 138)).toBe('0'.repeat(62) + '21');
    expect(data.slice(138)).toBe('ab'.repeat(33) + '0'.repeat(30));
  });

  it('rejects malformed or empty input rather than estimating from calldata', () => {
    expect(() => encodeGetL1FeeCall('')).toThrow('serialized unsigned RLP transaction');
    expect(() => encodeGetL1FeeCall('0x1')).toThrow('serialized unsigned RLP transaction');
    expect(() => encodeGetL1FeeCall('0xzz')).toThrow('serialized unsigned RLP transaction');
  });
});
