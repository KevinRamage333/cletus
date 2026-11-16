import { describe, expect, it } from 'vitest';
import {
  BASE_SWAP_ROUTER_02,
  encodeBaseExactInputSingle,
  serializeUnsignedBaseEip1559Transaction,
} from '@/lib/base-swap-route';

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const TOKEN = '0x0000000000000000000000000000000000000001';
const RECIPIENT = '0x0000000000000000000000000000000000000002';

describe('Base SwapRouter02 route encoding', () => {
  it('encodes the official Base SwapRouter02 exactInputSingle tuple', () => {
    const data = encodeBaseExactInputSingle({
      tokenIn: USDC, tokenOut: TOKEN, fee: 3000, recipient: RECIPIENT,
      amountIn: 1_000_000n, amountOutMinimum: 995_000n,
    });
    expect(BASE_SWAP_ROUTER_02.toLowerCase()).toBe('0x2626664c2603336e57b271c5c0b26f421741e481');
    expect(data.slice(0, 10)).toBe('0x04e45aaf');
    expect(data).toHaveLength(2 + 8 + 7 * 64);
    expect(data.slice(10, 74)).toBe('000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913');
  });

  it('rejects unsupported fees, same tokens, zero amounts and bad recipient', () => {
    const base = { tokenIn: USDC, tokenOut: TOKEN, fee: 3000, recipient: RECIPIENT, amountIn: 1n, amountOutMinimum: 1n };
    expect(() => encodeBaseExactInputSingle({ ...base, fee: 100 })).toThrow('Unsupported Uniswap v3 fee tier');
    expect(() => encodeBaseExactInputSingle({ ...base, tokenOut: USDC })).toThrow('different');
    expect(() => encodeBaseExactInputSingle({ ...base, amountIn: 0n })).toThrow('amountIn');
    expect(() => encodeBaseExactInputSingle({ ...base, recipient: '0x0000000000000000000000000000000000000000' })).toThrow('zero address');
  });

  it('serializes a valid unsigned EIP-1559 transaction with type byte 0x02', () => {
    const raw = serializeUnsignedBaseEip1559Transaction({
      chainId: 8453n, nonce: 1n, maxPriorityFeePerGas: 1n, maxFeePerGas: 2n,
      gasLimit: 21000n, to: BASE_SWAP_ROUTER_02, value: 0n, data: '0x1234',
    });
    expect(raw.startsWith('0x02')).toBe(true);
    expect(raw.length % 2).toBe(0);
    expect(raw).toContain('2626664c2603336e57b271c5c0b26f421741e481');
  });

  it('rejects a non-Base chain and malformed transaction data', () => {
    const base = {
      nonce: 0n, maxPriorityFeePerGas: 1n, maxFeePerGas: 2n,
      gasLimit: 21000n, to: BASE_SWAP_ROUTER_02, value: 0n, data: '0x',
    };
    expect(() => serializeUnsignedBaseEip1559Transaction({ ...base, chainId: 1n })).toThrow('chain ID 8453');
    expect(() => serializeUnsignedBaseEip1559Transaction({ ...base, chainId: 8453n, data: '0x1' })).toThrow('even-length');
    expect(() => serializeUnsignedBaseEip1559Transaction({ ...base, chainId: 8453n, maxPriorityFeePerGas: 3n })).toThrow('cannot exceed');
  });
});
