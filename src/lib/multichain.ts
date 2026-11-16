/**
 * Chain-neutral foundations for Cletus.
 *
 * This registry is metadata only. A network is NOT trade-ready merely because it
 * appears here. It must have a separately tested adapter and market-data source.
 * This module intentionally exposes paper-trading contracts only; no signer or
 * live-transaction method belongs in the multi-chain core.
 */

export type NetworkId =
  | 'solana'
  | 'ethereum'
  | 'base'
  | 'bnb'
  | 'arbitrum'
  | 'polygon'
  | 'avalanche'
  | 'sui';

export type NetworkFamily = 'solana' | 'evm' | 'sui';
export type NetworkStage = 'integrated' | 'planned';

export interface NetworkDefinition {
  id: NetworkId;
  name: string;
  family: NetworkFamily;
  stage: NetworkStage;
  chainId: number | null;
  nativeSymbol: string;
  explorerUrl: string;
  /** True only when the repository has a working, tested adapter today. */
  adapterReady: boolean;
  /** Mainnet trading stays disabled until adapter + paper validation gates pass. */
  paperTradingEnabled: boolean;
}

export const NETWORKS: readonly NetworkDefinition[] = [
  { id: 'solana', name: 'Solana', family: 'solana', stage: 'integrated', chainId: null, nativeSymbol: 'SOL', explorerUrl: 'https://explorer.solana.com', adapterReady: true, paperTradingEnabled: true },
  { id: 'ethereum', name: 'Ethereum', family: 'evm', stage: 'planned', chainId: 1, nativeSymbol: 'ETH', explorerUrl: 'https://etherscan.io', adapterReady: false, paperTradingEnabled: false },
  { id: 'base', name: 'Base', family: 'evm', stage: 'planned', chainId: 8453, nativeSymbol: 'ETH', explorerUrl: 'https://basescan.org', adapterReady: false, paperTradingEnabled: false },
  { id: 'bnb', name: 'BNB Chain', family: 'evm', stage: 'planned', chainId: 56, nativeSymbol: 'BNB', explorerUrl: 'https://bscscan.com', adapterReady: false, paperTradingEnabled: false },
  { id: 'arbitrum', name: 'Arbitrum One', family: 'evm', stage: 'planned', chainId: 42161, nativeSymbol: 'ETH', explorerUrl: 'https://arbiscan.io', adapterReady: false, paperTradingEnabled: false },
  { id: 'polygon', name: 'Polygon PoS', family: 'evm', stage: 'planned', chainId: 137, nativeSymbol: 'POL', explorerUrl: 'https://polygonscan.com', adapterReady: false, paperTradingEnabled: false },
  { id: 'avalanche', name: 'Avalanche C-Chain', family: 'evm', stage: 'planned', chainId: 43114, nativeSymbol: 'AVAX', explorerUrl: 'https://snowtrace.io', adapterReady: false, paperTradingEnabled: false },
  { id: 'sui', name: 'Sui', family: 'sui', stage: 'planned', chainId: null, nativeSymbol: 'SUI', explorerUrl: 'https://suiscan.xyz', adapterReady: false, paperTradingEnabled: false },
] as const;

export function getNetwork(id: string): NetworkDefinition | undefined {
  return NETWORKS.find((network) => network.id === id);
}

/** Assets are chain-scoped: the same ticker/address string on two networks is not the same asset. */
export interface AssetIdentity {
  network: NetworkId;
  address: string;
}

export function assetKey(asset: AssetIdentity): string {
  const address = asset.address.trim();
  if (!address) throw new Error('Asset address is required');
  const network = getNetwork(asset.network);
  if (!network) throw new Error(`Unsupported network: ${asset.network}`);
  // EVM addresses are case-insensitive. Solana and Sui object/type identifiers are not.
  return network.family === 'evm'
    ? `${asset.network}:${address.toLowerCase()}`
    : `${asset.network}:${address}`;
}

export interface PaperQuote {
  network: NetworkId;
  input: AssetIdentity;
  output: AssetIdentity;
  inputAmount: string;
  expectedOutputAmount: string;
  priceImpactBps: number;
  estimatedNetworkFeeUsd: number;
  quotedAtMs: number;
  source: string;
}

export interface PaperTradeIntent {
  network: NetworkId;
  asset: AssetIdentity;
  side: 'buy' | 'sell';
  notionalUsd: number;
  createdAtMs: number;
}

export interface PaperFill {
  network: NetworkId;
  asset: AssetIdentity;
  side: 'buy' | 'sell';
  notionalUsd: number;
  filledAmount: string;
  referencePriceUsd: number;
  totalCostsUsd: number;
  simulated: true;
  quoteSource: string;
  filledAtMs: number;
}

/**
 * Implementations must use public/read-only market data and return quotes only.
 * Swap signing/broadcasting is deliberately outside this shared contract.
 */
export interface ChainPaperAdapter {
  readonly network: NetworkId;
  discoverAssets(): Promise<AssetIdentity[]>;
  getPaperQuote(input: AssetIdentity, output: AssetIdentity, amount: string): Promise<PaperQuote>;
  simulateFill(intent: PaperTradeIntent, quote: PaperQuote): Promise<PaperFill>;
}

export interface PaperValidationLimits {
  maxQuoteAgeMs: number;
  maxPriceImpactBps: number;
  maxNetworkFeeUsd: number;
  nowMs?: number;
}

/** Fail closed on stale, malformed, cross-chain, or uneconomic quotes. */
export function validatePaperQuote(
  intent: PaperTradeIntent,
  quote: PaperQuote,
  limits: PaperValidationLimits,
): { ok: true } | { ok: false; reason: string } {
  const now = limits.nowMs ?? Date.now();
  const network = getNetwork(intent.network);
  if (!network?.paperTradingEnabled || !network.adapterReady) return { ok: false, reason: 'network adapter is not enabled for paper trading' };
  if (quote.network !== intent.network || quote.input.network !== intent.network || quote.output.network !== intent.network) {
    return { ok: false, reason: 'quote network mismatch' };
  }
  if (assetKey(intent.asset) !== assetKey(intent.side === 'buy' ? quote.output : quote.input)) {
    return { ok: false, reason: 'quote does not match intended asset and side' };
  }
  if (!Number.isFinite(intent.notionalUsd) || intent.notionalUsd <= 0) return { ok: false, reason: 'notional must be positive' };
  if (!Number.isFinite(quote.priceImpactBps) || quote.priceImpactBps < 0 || quote.priceImpactBps > limits.maxPriceImpactBps) {
    return { ok: false, reason: 'price impact exceeds paper-trading limit' };
  }
  if (!Number.isFinite(quote.estimatedNetworkFeeUsd) || quote.estimatedNetworkFeeUsd < 0 || quote.estimatedNetworkFeeUsd > limits.maxNetworkFeeUsd) {
    return { ok: false, reason: 'network fee exceeds paper-trading limit' };
  }
  if (!Number.isFinite(quote.quotedAtMs) || quote.quotedAtMs > now || now - quote.quotedAtMs > limits.maxQuoteAgeMs) {
    return { ok: false, reason: 'quote is stale or has an invalid timestamp' };
  }
  if (!(Number(quote.inputAmount) > 0) || !(Number(quote.expectedOutputAmount) > 0)) {
    return { ok: false, reason: 'quote amounts must be positive' };
  }
  return { ok: true };
}
