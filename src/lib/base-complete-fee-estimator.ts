/**
 * Complete, read-only Base swap fee estimator.
 *
 * Combines a fresh QuoterV2 quote, exact SwapRouter02 calldata, an RPC gas
 * estimate from the caller's public address, an unsigned EIP-1559 envelope,
 * and the official Base GasPriceOracle L1 data fee.
 *
 * This is estimation only: no approvals, signing, broadcasting, persistence,
 * wallet access, or balance changes. A wallet address is public input only.
 */
import { getBasePaperQuote, type BasePaperQuote, type BasePaperQuoteRequest } from './base-paper-simulator';
import { estimateBaseL1DataFee } from './base-gas-oracle';
import {
  BASE_CHAIN_ID,
  BASE_SWAP_ROUTER_02,
  encodeBaseExactInputSingle,
  serializeUnsignedBaseEip1559Transaction,
} from './base-swap-route';

const BASE_RPC_DEFAULT = 'https://mainnet.base.org';
const REQUEST_TIMEOUT_MS = 10_000;
const GAS_BUFFER_NUMERATOR = 120n;
const GAS_BUFFER_DENOMINATOR = 100n;

type RpcResponse<T> = {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string };
};

export interface BaseCompleteFeeRequest extends BasePaperQuoteRequest {
  /** Public EVM address used as transaction sender and recipient. */
  walletAddress: string;
}

export interface BaseCompleteFeeEstimate {
  network: 'base';
  chainId: 8453;
  feeEstimateComplete: true;
  estimateType: 'current-unsigned-router-envelope';
  quote: BasePaperQuote;
  router: string;
  walletAddress: string;
  poolFeeTier: number;
  estimatedRouterGasUnits: string;
  bufferedGasLimit: string;
  nonce: string;
  maxPriorityFeePerGasWei: string;
  maxFeePerGasWei: string;
  estimatedL2FeeWei: string;
  estimatedL1DataFeeWei: string;
  estimatedL2FeeUsd: number;
  estimatedL1DataFeeUsd: number;
  estimatedTotalFeeUsd: number;
  unsignedTransactionBytes: number;
  estimatedAtMs: number;
  warnings: string[];
}

function assertAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error('A valid non-zero public Base wallet address is required');
  }
  return value.toLowerCase();
}

export function parseBaseDecimalUnits(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('Token decimals are outside supported range');
  }
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error('Amount must be a positive decimal number');
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) throw new Error(`Amount supports at most ${decimals} decimal places`);
  const raw = BigInt(whole) * (10n ** BigInt(decimals))
    + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (raw <= 0n) throw new Error('Amount must be greater than zero');
  return raw;
}

export function applyBaseGasBuffer(gasEstimate: bigint): bigint {
  if (gasEstimate <= 0n) throw new Error('Router gas estimate must be greater than zero');
  return (gasEstimate * GAS_BUFFER_NUMERATOR + GAS_BUFFER_DENOMINATOR - 1n) / GAS_BUFFER_DENOMINATOR;
}

export function calculateBaseMaxL2FeeWei(gasLimit: bigint, maxFeePerGasWei: bigint): bigint {
  if (gasLimit <= 0n || maxFeePerGasWei <= 0n) throw new Error('Gas limit and max fee per gas must be positive');
  return gasLimit * maxFeePerGasWei;
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
  if (body.error || body.result === undefined) {
    throw new Error(body.error?.message ?? `Base RPC ${method} returned no result`);
  }
  return body.result;
}

/**
 * Returns a complete current-envelope estimate only if router eth_estimateGas
 * and the official L1 oracle both succeed. Missing token balance/allowance can
 * cause eth_estimateGas to revert; this function never creates an approval.
 */
export async function getBaseCompleteFeeEstimate(
  request: BaseCompleteFeeRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<BaseCompleteFeeEstimate> {
  const walletAddress = assertAddress(request.walletAddress);
  const rpcUrl = env.BASE_RPC_URL?.trim() || BASE_RPC_DEFAULT;
  const quote = await getBasePaperQuote(request, env);

  const amountIn = parseBaseDecimalUnits(quote.inputAmount, quote.inputDecimals);
  const amountOutMinimum = parseBaseDecimalUnits(quote.minimumOutputAmount, quote.outputDecimals);
  const calldata = encodeBaseExactInputSingle({
    tokenIn: quote.inputToken,
    tokenOut: quote.outputToken,
    fee: quote.poolFeeTier,
    recipient: walletAddress,
    amountIn,
    amountOutMinimum,
  });

  const [chainIdHex, nonceHex, gasEstimateHex, priorityFeeHex, latestBlock] = await Promise.all([
    rpc<string>('eth_chainId', [], rpcUrl),
    rpc<string>('eth_getTransactionCount', [walletAddress, 'pending'], rpcUrl),
    rpc<string>('eth_estimateGas', [{
      from: walletAddress,
      to: BASE_SWAP_ROUTER_02,
      value: '0x0',
      data: calldata,
    }, 'latest'], rpcUrl),
    rpc<string>('eth_maxPriorityFeePerGas', [], rpcUrl),
    rpc<{ baseFeePerGas?: string }>('eth_getBlockByNumber', ['latest', false], rpcUrl),
  ]);

  if (Number(BigInt(chainIdHex)) !== BASE_CHAIN_ID) {
    throw new Error('Configured RPC is not Base mainnet (chain ID 8453)');
  }
  if (!latestBlock?.baseFeePerGas) throw new Error('Base RPC did not provide the latest EIP-1559 base fee');

  const nonce = BigInt(nonceHex);
  const gasEstimate = BigInt(gasEstimateHex);
  const gasLimit = applyBaseGasBuffer(gasEstimate);
  const priorityFee = BigInt(priorityFeeHex);
  const baseFee = BigInt(latestBlock.baseFeePerGas);
  const maxFeePerGas = baseFee * 2n + priorityFee;
  if (maxFeePerGas <= 0n || priorityFee > maxFeePerGas) {
    throw new Error('Base RPC returned invalid EIP-1559 fee data');
  }

  const unsignedTransaction = serializeUnsignedBaseEip1559Transaction({
    chainId: BigInt(BASE_CHAIN_ID),
    nonce,
    maxPriorityFeePerGas: priorityFee,
    maxFeePerGas,
    gasLimit,
    to: BASE_SWAP_ROUTER_02,
    value: 0n,
    data: calldata,
  });
  const l1 = await estimateBaseL1DataFee(unsignedTransaction, env);
  const l2FeeWei = calculateBaseMaxL2FeeWei(gasLimit, maxFeePerGas);
  const ethUsd = quote.ethUsd;
  const weiPerEth = 1e18;
  const estimatedL2FeeUsd = Number(l2FeeWei) / weiPerEth * ethUsd;
  const estimatedL1DataFeeUsd = Number(BigInt(l1.l1FeeWei)) / weiPerEth * ethUsd;
  const estimatedTotalFeeUsd = estimatedL2FeeUsd + estimatedL1DataFeeUsd;

  if (![estimatedL2FeeUsd, estimatedL1DataFeeUsd, estimatedTotalFeeUsd].every(Number.isFinite)) {
    throw new Error('Base total fee conversion produced a non-finite USD amount');
  }

  return {
    network: 'base',
    chainId: BASE_CHAIN_ID,
    feeEstimateComplete: true,
    estimateType: 'current-unsigned-router-envelope',
    quote,
    router: BASE_SWAP_ROUTER_02,
    walletAddress,
    poolFeeTier: quote.poolFeeTier,
    estimatedRouterGasUnits: gasEstimate.toString(),
    bufferedGasLimit: gasLimit.toString(),
    nonce: nonce.toString(),
    maxPriorityFeePerGasWei: priorityFee.toString(),
    maxFeePerGasWei: maxFeePerGas.toString(),
    estimatedL2FeeWei: l2FeeWei.toString(),
    estimatedL1DataFeeWei: l1.l1FeeWei,
    estimatedL2FeeUsd,
    estimatedL1DataFeeUsd,
    estimatedTotalFeeUsd,
    unsignedTransactionBytes: l1.unsignedTransactionBytes,
    estimatedAtMs: Date.now(),
    warnings: [
      'Single-hop Uniswap v3 only; other Base DEXs and multi-hop routes are not included.',
      'The wallet address is used only as public eth_estimateGas input; no wallet is connected or controlled.',
      'A missing token balance or allowance can make eth_estimateGas revert. Cletus will not request or create approvals.',
      'The L1 fee is exact for the serialized unsigned transaction bytes supplied to the oracle; nonce, fee caps, network state and transaction data can change before any future transaction.',
      'The L2 amount is a conservative maximum-fee budget using a 20% gas buffer, not a guaranteed final charge.',
      'A complete fee estimate does not establish token safety, executable liquidity after quote time, or profitability.',
      'Paper only: no transaction is signed, broadcast, persisted, or applied to an account balance.',
    ],
  };
}
