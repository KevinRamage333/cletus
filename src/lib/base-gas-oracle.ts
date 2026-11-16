/**
 * Base GasPriceOracle read-only L1 data-fee adapter.
 *
 * The oracle requires a fully serialized unsigned RLP transaction, not
 * arbitrary router calldata. This module deliberately does not construct,
 * sign, or broadcast transactions. Callers must supply the unsigned RLP bytes
 * produced by a trusted transaction builder.
 */
const BASE_CHAIN_ID = 8453;
const BASE_RPC_DEFAULT = 'https://mainnet.base.org';
const GAS_PRICE_ORACLE = '0x420000000000000000000000000000000000000F';
const GET_L1_FEE_SELECTOR = '0x939e1e40';
const REQUEST_TIMEOUT_MS = 10_000;

type RpcResponse<T> = {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string };
};

function normalizeUnsignedTransactionHex(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^0x(?:[0-9a-f]{2})+$/.test(normalized)) {
    throw new Error('A non-empty, even-length serialized unsigned RLP transaction hex string is required');
  }
  return normalized;
}

/** ABI-encodes GasPriceOracle.getL1Fee(bytes). */
export function encodeGetL1FeeCall(unsignedRlpTransaction: string): string {
  const tx = normalizeUnsignedTransactionHex(unsignedRlpTransaction).slice(2);
  const byteLength = tx.length / 2;
  const padded = tx.padEnd(Math.ceil(tx.length / 64) * 64, '0');
  return GET_L1_FEE_SELECTOR
    + '0'.repeat(63) + '20'
    + byteLength.toString(16).padStart(64, '0')
    + padded;
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

export interface BaseL1FeeEstimate {
  network: 'base';
  chainId: 8453;
  oracle: string;
  l1FeeWei: string;
  source: 'base-gas-price-oracle-getL1Fee';
  exactForProvidedUnsignedTransaction: true;
  unsignedTransactionBytes: number;
  estimatedAtMs: number;
}

/**
 * Reads the official Base GasPriceOracle for a fully serialized unsigned RLP
 * transaction. The returned fee is exact for those supplied bytes and current
 * oracle state; it is not a prediction for a different/future transaction.
 */
export async function estimateBaseL1DataFee(
  unsignedRlpTransaction: string,
  env: Record<string, string | undefined> = process.env,
): Promise<BaseL1FeeEstimate> {
  const normalized = normalizeUnsignedTransactionHex(unsignedRlpTransaction);
  const rpcUrl = env.BASE_RPC_URL?.trim() || BASE_RPC_DEFAULT;
  const chainIdHex = await rpc<string>('eth_chainId', [], rpcUrl);
  if (Number(BigInt(chainIdHex)) !== BASE_CHAIN_ID) {
    throw new Error('Configured RPC is not Base mainnet (chain ID 8453)');
  }
  const data = encodeGetL1FeeCall(normalized);
  const result = await rpc<string>('eth_call', [{ to: GAS_PRICE_ORACLE, data }, 'latest'], rpcUrl);
  if (!/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error('Base GasPriceOracle returned an invalid uint256 fee');
  }
  const fee = BigInt(result);
  return {
    network: 'base',
    chainId: BASE_CHAIN_ID,
    oracle: GAS_PRICE_ORACLE.toLowerCase(),
    l1FeeWei: fee.toString(),
    source: 'base-gas-price-oracle-getL1Fee',
    exactForProvidedUnsignedTransaction: true,
    unsignedTransactionBytes: (normalized.length - 2) / 2,
    estimatedAtMs: Date.now(),
  };
}
