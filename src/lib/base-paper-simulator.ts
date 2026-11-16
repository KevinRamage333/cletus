/**
 * Base mainnet Uniswap v3 paper quote + fill preview.
 *
 * Read-only JSON-RPC eth_call only. No signer, router calldata, approvals,
 * transaction submission, database writes, or live execution.
 *
 * Fee limitation: this estimates L2 execution cost from QuoterV2 gas usage and
 * eth_gasPrice. It does NOT include Base's L1 data fee, so the fee estimate is
 * explicitly incomplete and must not be used as a final profitability gate.
 */
const BASE_CHAIN_ID = 8453;
const BASE_RPC_DEFAULT = 'https://mainnet.base.org';
const QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ETH_USD_URL = 'https://api.coinbase.com/v2/prices/ETH-USD/spot';
const QUOTE_SELECTOR = '0xc6a5026a'; // quoteExactInputSingle(QuoteExactInputSingleParams)
const DECIMALS_SELECTOR = '0x313ce567';
const FEE_TIERS = [500, 3000, 10000] as const;
const MAX_NOTIONAL_USD = 10_000;
const MAX_SLIPPAGE_BPS = 300;
const DEFAULT_SLIPPAGE_BPS = 50;
const REQUEST_TIMEOUT_MS = 10_000;

export type BasePaperSide = 'buy' | 'sell';
export interface BasePaperQuoteRequest {
  tokenAddress: string;
  side: BasePaperSide;
  /** Buy: USDC input amount. Sell: token input amount. Human-readable decimal string. */
  amountIn: string;
  slippageBps?: number;
}
export interface BasePaperQuote {
  network: 'base';
  chainId: 8453;
  tokenAddress: string;
  side: BasePaperSide;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  expectedOutputAmount: string;
  inputDecimals: number;
  outputDecimals: number;
  poolFeeTier: number;
  quotedAtMs: number;
  quoteSource: 'uniswap-v3-quoter-v2';
  estimatedL2GasUnits: string;
  gasPriceWei: string;
  ethUsd: number;
  estimatedL2FeeUsd: number;
  l1DataFeeUsd: null;
  feeEstimateComplete: false;
  estimatedTotalFeeUsd: number;
  slippageBps: number;
  minimumOutputAmount: string;
  referencePriceUsd: number;
  warnings: string[];
}
export interface BasePaperFillPreview {
  network: 'base';
  simulated: true;
  persisted: false;
  broadcast: false;
  side: BasePaperSide;
  tokenAddress: string;
  inputAmount: string;
  expectedOutputAmount: string;
  simulatedOutputAmount: string;
  referencePriceUsd: number;
  estimatedL2FeeUsd: number;
  feeEstimateComplete: false;
  slippageBps: number;
  quoteSource: string;
  createdAtMs: number;
  warnings: string[];
}
type RpcResponse<T> = { jsonrpc: '2.0'; id: number; result?: T; error?: { code: number; message: string } };

function assertAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('A valid Base ERC-20 contract address is required');
  return address.toLowerCase();
}
function parseUnits(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) throw new Error('Amount must be a positive decimal number');
  const [whole, fraction = ''] = value.trim().split('.');
  if (fraction.length > decimals) throw new Error(`Amount supports at most ${decimals} decimal places`);
  const raw = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (raw <= 0n) throw new Error('Amount must be greater than zero');
  return raw;
}
function formatUnits(value: bigint, decimals: number, precision = decimals): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').slice(0, precision).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function word(value: bigint): string {
  if (value < 0n || value >= (1n << 256n)) throw new Error('ABI integer out of range');
  return value.toString(16).padStart(64, '0');
}
function addressWord(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, '0');
}
export function encodeQuoteExactInputSingle(tokenIn: string, tokenOut: string, fee: number, amountIn: bigint): string {
  if (!Number.isInteger(fee) || fee <= 0 || fee >= 1_000_000) throw new Error('Invalid Uniswap pool fee tier');
  return QUOTE_SELECTOR + [
    addressWord(assertAddress(tokenIn)),
    addressWord(assertAddress(tokenOut)),
    word(BigInt(fee)),
    word(amountIn),
    word(0n),
  ].join('');
}
export function decodeQuoterV2Result(data: string): { amountOut: bigint; gasEstimate: bigint } {
  if (!/^0x[0-9a-fA-F]{256}$/.test(data)) throw new Error('Unexpected QuoterV2 response');
  const body = data.slice(2);
  return {
    amountOut: BigInt(`0x${body.slice(0, 64)}`),
    gasEstimate: BigInt(`0x${body.slice(192, 256)}`),
  };
}
export function applySlippage(amount: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > MAX_SLIPPAGE_BPS) {
    throw new Error(`Slippage must be between 0 and ${MAX_SLIPPAGE_BPS} bps`);
  }
  return amount * BigInt(10_000 - slippageBps) / 10_000n;
}
async function rpc<T>(method: string, params: unknown[], rpcUrl: string): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Base RPC HTTP ${response.status}`);
  const body = await response.json() as RpcResponse<T>;
  if (body.error || body.result === undefined) throw new Error(body.error?.message ?? `Base RPC ${method} returned no result`);
  return body.result;
}
async function tokenDecimals(address: string, rpcUrl: string): Promise<number> {
  const result = await rpc<string>('eth_call', [{ to: address, data: DECIMALS_SELECTOR }, 'latest'], rpcUrl);
  if (!/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('Token decimals response is invalid');
  const decimals = Number(BigInt(result));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Token decimals are outside supported range');
  return decimals;
}
async function getEthUsd(): Promise<number> {
  const response = await fetch(ETH_USD_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`ETH/USD reference price HTTP ${response.status}`);
  const body = await response.json() as { data?: { amount?: string } };
  const price = Number(body.data?.amount);
  if (!Number.isFinite(price) || price <= 0) throw new Error('ETH/USD reference price is invalid');
  return price;
}
function quotePriceUsd(side: BasePaperSide, amountIn: bigint, amountOut: bigint, inputDecimals: number, outputDecimals: number): number {
  const input = Number(formatUnits(amountIn, inputDecimals, 12));
  const output = Number(formatUnits(amountOut, outputDecimals, 12));
  const price = side === 'buy' ? input / output : output / input;
  if (!Number.isFinite(price) || price <= 0) throw new Error('Unable to calculate quote reference price');
  return price;
}

/**
 * Gets a real on-chain read-only quote from Base Uniswap v3 QuoterV2.
 * Buy input is native USDC; sell input is the token being sold.
 */
export async function getBasePaperQuote(
  request: BasePaperQuoteRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<BasePaperQuote> {
  const token = assertAddress(request.tokenAddress);
  if (token === BASE_USDC.toLowerCase()) throw new Error('Token address cannot be the USDC settlement token');
  if (request.side !== 'buy' && request.side !== 'sell') throw new Error('Side must be buy or sell');
  const slippageBps = request.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > MAX_SLIPPAGE_BPS) {
    throw new Error(`Slippage must be between 0 and ${MAX_SLIPPAGE_BPS} bps`);
  }
  const rpcUrl = env.BASE_RPC_URL?.trim() || BASE_RPC_DEFAULT;
  const chainId = await rpc<string>('eth_chainId', [], rpcUrl);
  if (Number(BigInt(chainId)) !== BASE_CHAIN_ID) throw new Error('Configured RPC is not Base mainnet (chain ID 8453)');

  const inputToken = request.side === 'buy' ? BASE_USDC.toLowerCase() : token;
  const outputToken = request.side === 'buy' ? token : BASE_USDC.toLowerCase();
  const [inputDecimals, outputDecimals, gasPriceHex, ethUsd] = await Promise.all([
    tokenDecimals(inputToken, rpcUrl),
    tokenDecimals(outputToken, rpcUrl),
    rpc<string>('eth_gasPrice', [], rpcUrl),
    getEthUsd(),
  ]);
  const amountIn = parseUnits(request.amountIn, inputDecimals);
  if (request.side === 'buy' && Number(request.amountIn) > MAX_NOTIONAL_USD) {
    throw new Error(`Paper quote is capped at $${MAX_NOTIONAL_USD.toLocaleString()} per request`);
  }
  const gasPriceWei = BigInt(gasPriceHex);
  if (gasPriceWei <= 0n) throw new Error('Base RPC returned an invalid gas price');

  const results = await Promise.allSettled(FEE_TIERS.map(async (fee) => {
    const data = encodeQuoteExactInputSingle(inputToken, outputToken, fee, amountIn);
    const result = await rpc<string>('eth_call', [{ to: QUOTER_V2, data }, 'latest'], rpcUrl);
    const decoded = decodeQuoterV2Result(result);
    if (decoded.amountOut <= 0n || decoded.gasEstimate <= 0n) throw new Error('No executable liquidity at this fee tier');
    return { fee, ...decoded };
  }));
  const quotes = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (!quotes.length) throw new Error('No Uniswap v3 Base pool returned a valid quote for this token and amount');
  const best = quotes.reduce((a, b) => b.amountOut > a.amountOut ? b : a);
  const gasWithBuffer = (best.gasEstimate * 125n + 99n) / 100n;
  const l2FeeWei = gasWithBuffer * gasPriceWei;
  const l2FeeEth = Number(l2FeeWei) / 1e18;
  const estimatedL2FeeUsd = l2FeeEth * ethUsd;
  if (!Number.isFinite(estimatedL2FeeUsd) || estimatedL2FeeUsd < 0) throw new Error('L2 fee estimate is invalid');
  const minimumOutput = applySlippage(best.amountOut, slippageBps);
  const referencePriceUsd = quotePriceUsd(request.side, amountIn, best.amountOut, inputDecimals, outputDecimals);
  const warnings = [
    'Quote uses a single Uniswap v3 pool only; other Base DEXs and multi-hop routes are not searched.',
    'Gas estimate is based on QuoterV2 gas usage with a 25% buffer; actual router execution may differ.',
    'L1 data fee is not included. Base total transaction cost is therefore incomplete.',
    'This is a paper preview only and is not an order, executable calldata, or guarantee of a fill.',
  ];
  return {
    network: 'base', chainId: BASE_CHAIN_ID, tokenAddress: token, side: request.side,
    inputToken, outputToken, inputAmount: formatUnits(amountIn, inputDecimals),
    expectedOutputAmount: formatUnits(best.amountOut, outputDecimals),
    inputDecimals, outputDecimals, poolFeeTier: best.fee, quotedAtMs: Date.now(),
    quoteSource: 'uniswap-v3-quoter-v2', estimatedL2GasUnits: gasWithBuffer.toString(),
    gasPriceWei: gasPriceWei.toString(), ethUsd, estimatedL2FeeUsd,
    l1DataFeeUsd: null, feeEstimateComplete: false, estimatedTotalFeeUsd: estimatedL2FeeUsd,
    slippageBps, minimumOutputAmount: formatUnits(minimumOutput, outputDecimals),
    referencePriceUsd, warnings,
  };
}

/** Pure, non-persistent fill preview. Adverse slippage is applied to output, not input. */
export function simulateBasePaperFill(quote: BasePaperQuote): BasePaperFillPreview {
  const amountOutRaw = parseUnits(quote.expectedOutputAmount, quote.outputDecimals);
  const simulatedOutputRaw = applySlippage(amountOutRaw, quote.slippageBps);
  return {
    network: 'base', simulated: true, persisted: false, broadcast: false,
    side: quote.side, tokenAddress: quote.tokenAddress, inputAmount: quote.inputAmount,
    expectedOutputAmount: quote.expectedOutputAmount,
    simulatedOutputAmount: formatUnits(simulatedOutputRaw, quote.outputDecimals),
    referencePriceUsd: quote.referencePriceUsd, estimatedL2FeeUsd: quote.estimatedL2FeeUsd,
    feeEstimateComplete: false, slippageBps: quote.slippageBps,
    quoteSource: quote.quoteSource, createdAtMs: Date.now(),
    warnings: [...quote.warnings, 'Fill preview is not stored in the portfolio and cannot affect account balances.'],
  };
}
