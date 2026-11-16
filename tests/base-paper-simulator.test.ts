import { describe, expect, it } from 'vitest';
import { applySlippage, decodeQuoterV2Result, encodeQuoteExactInputSingle, simulateBasePaperFill, type BasePaperQuote } from '@/lib/base-paper-simulator';

describe('Base paper quote primitives', () => {
  it('encodes the Uniswap v3 QuoterV2 single-hop tuple', () => {
    const data = encodeQuoteExactInputSingle('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '0x4200000000000000000000000000000000000006', 3000, 1_000_000n);
    expect(data.slice(0, 10)).toBe('0xc6a5026a');
    expect(data).toHaveLength(10 + 5 * 64);
    expect(data.slice(10, 74)).toBe('000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913');
  });

  it('decodes amountOut and gas estimate from the four-word QuoterV2 result', () => {
    const words = [123n, 456n, 7n, 89n].map((v) => v.toString(16).padStart(64, '0'));
    expect(decodeQuoterV2Result('0x' + words.join(''))).toEqual({ amountOut: 123n, gasEstimate: 89n });
  });

  it('rejects malformed QuoterV2 response', () => {
    expect(() => decodeQuoterV2Result('0x1234')).toThrow('Unexpected QuoterV2 response');
  });

  it('applies adverse slippage using integer arithmetic', () => {
    expect(applySlippage(1_000_000n, 50)).toBe(995_000n);
    expect(() => applySlippage(1_000n, 301)).toThrow('Slippage must be between 0 and 300 bps');
  });

  it('creates a paper-only preview and clearly marks the incomplete L1 fee estimate', () => {
    const quote: BasePaperQuote = {
      network: 'base', chainId: 8453, tokenAddress: '0x0000000000000000000000000000000000000001',
      side: 'buy', inputToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      outputToken: '0x0000000000000000000000000000000000000001',
      inputAmount: '100', expectedOutputAmount: '200', inputDecimals: 6, outputDecimals: 18,
      poolFeeTier: 3000, quotedAtMs: 1000, quoteSource: 'uniswap-v3-quoter-v2',
      estimatedL2GasUnits: '200000', gasPriceWei: '1000000', ethUsd: 3000,
      estimatedL2FeeUsd: 0.01, l1DataFeeUsd: null, feeEstimateComplete: false,
      estimatedTotalFeeUsd: 0.01, slippageBps: 50, minimumOutputAmount: '199',
      referencePriceUsd: 0.5, warnings: ['L1 fee omitted'],
    };
    const fill = simulateBasePaperFill(quote);
    expect(fill).toMatchObject({ network: 'base', simulated: true, persisted: false, broadcast: false, feeEstimateComplete: false });
    expect(fill.simulatedOutputAmount).toBe('199');
    expect(fill.warnings.some((warning) => warning.includes('not stored'))).toBe(true);
  });
});
