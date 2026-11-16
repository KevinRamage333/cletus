import { describe, expect, it } from 'vitest';
import { assetKey, getNetwork, NETWORKS, validatePaperQuote, type PaperQuote, type PaperTradeIntent } from '@/lib/multichain';

describe('multi-chain foundation', () => {
  it('registers the initial target networks without pretending planned adapters are ready', () => {
    expect(NETWORKS.map((n) => n.id)).toEqual(['solana', 'ethereum', 'base', 'bnb', 'arbitrum', 'polygon', 'avalanche', 'sui']);
    expect(getNetwork('solana')?.paperTradingEnabled).toBe(true);
    expect(getNetwork('base')?.adapterReady).toBe(false);
    expect(getNetwork('sui')?.family).toBe('sui');
  });

  it('normalizes EVM addresses but keeps non-EVM identifiers case-sensitive', () => {
    expect(assetKey({ network: 'base', address: '0xAbC' })).toBe(assetKey({ network: 'base', address: '0xabc' }));
    expect(assetKey({ network: 'solana', address: 'AbC' })).not.toBe(assetKey({ network: 'solana', address: 'abc' }));
    expect(assetKey({ network: 'base', address: '0xabc' })).not.toBe(assetKey({ network: 'ethereum', address: '0xabc' }));
  });

  it('rejects planned networks until an adapter is implemented and enabled', () => {
    const intent: PaperTradeIntent = { network: 'base', asset: { network: 'base', address: '0xabc' }, side: 'buy', notionalUsd: 10, createdAtMs: 1_000 };
    const quote: PaperQuote = { network: 'base', input: { network: 'base', address: '0xusdc' }, output: intent.asset, inputAmount: '10', expectedOutputAmount: '5', priceImpactBps: 10, estimatedNetworkFeeUsd: 0.01, quotedAtMs: 1_000, source: 'test' };
    expect(validatePaperQuote(intent, quote, { maxQuoteAgeMs: 10_000, maxPriceImpactBps: 100, maxNetworkFeeUsd: 1, nowMs: 1_001 })).toEqual({ ok: false, reason: 'network adapter is not enabled for paper trading' });
  });

  it('accepts a fresh, same-network Solana paper quote', () => {
    const intent: PaperTradeIntent = { network: 'solana', asset: { network: 'solana', address: 'TOKEN' }, side: 'buy', notionalUsd: 10, createdAtMs: 1_000 };
    const quote: PaperQuote = { network: 'solana', input: { network: 'solana', address: 'USDC' }, output: intent.asset, inputAmount: '10', expectedOutputAmount: '100', priceImpactBps: 20, estimatedNetworkFeeUsd: 0.01, quotedAtMs: 1_000, source: 'fixture' };
    expect(validatePaperQuote(intent, quote, { maxQuoteAgeMs: 10_000, maxPriceImpactBps: 100, maxNetworkFeeUsd: 1, nowMs: 1_001 })).toEqual({ ok: true });
  });

  it('rejects cross-network and stale quotes', () => {
    const intent: PaperTradeIntent = { network: 'solana', asset: { network: 'solana', address: 'TOKEN' }, side: 'buy', notionalUsd: 10, createdAtMs: 1_000 };
    const quote: PaperQuote = { network: 'ethereum', input: { network: 'ethereum', address: 'USDC' }, output: { network: 'ethereum', address: 'TOKEN' }, inputAmount: '10', expectedOutputAmount: '100', priceImpactBps: 20, estimatedNetworkFeeUsd: 0.01, quotedAtMs: 1_000, source: 'fixture' };
    expect(validatePaperQuote(intent, quote, { maxQuoteAgeMs: 100, maxPriceImpactBps: 100, maxNetworkFeeUsd: 1, nowMs: 1_001 })).toEqual({ ok: false, reason: 'quote network mismatch' });
    const stale = { ...quote, network: 'solana' as const, input: { network: 'solana' as const, address: 'USDC' }, output: intent.asset, quotedAtMs: 1 };
    expect(validatePaperQuote(intent, stale, { maxQuoteAgeMs: 100, maxPriceImpactBps: 100, maxNetworkFeeUsd: 1, nowMs: 1_001 })).toEqual({ ok: false, reason: 'quote is stale or has an invalid timestamp' });
  });
});
