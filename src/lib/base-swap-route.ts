/**
 * Base Uniswap v3 SwapRouter02 route-data builder.
 *
 * Pure encoding only. It does not submit eth_call, request approvals, sign,
 * broadcast, or persist transactions. The caller must provide the recipient
 * public address and the exact fee/amounts from a separately validated quote.
 */
export const BASE_CHAIN_ID = 8453;
export const BASE_SWAP_ROUTER_02 = '0x2626664c2603336E57B271c5C0b26F421741e481';
const EXACT_INPUT_SINGLE_SELECTOR = '0x04e45aaf';
const ALLOWED_FEE_TIERS = new Set([500, 3000, 10000]);
const UINT24_MAX = (1n << 24n) - 1n;
const UINT160_MAX = (1n << 160n) - 1n;

export interface BaseExactInputSingleRequest {
  tokenIn: string;
  tokenOut: string;
  fee: number;
  recipient: string;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96?: bigint;
}

export interface UnsignedEip1559Transaction {
  chainId: bigint;
  nonce: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  to: string;
  value: bigint;
  data: string;
}

function address(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${field} must be a valid EVM address`);
  const normalized = value.toLowerCase();
  if (/^0x0{40}$/.test(normalized)) throw new Error(`${field} cannot be the zero address`);
  return normalized;
}

function uint(value: bigint, bits: number, field: string, allowZero = true): bigint {
  if (typeof value !== 'bigint' || value < 0n || value >= (1n << BigInt(bits)) || (!allowZero && value === 0n)) {
    throw new Error(`${field} must be a valid uint${bits}${allowZero ? '' : ' greater than zero'}`);
  }
  return value;
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function addressWord(value: string, field: string): string {
  return address(value, field).slice(2).padStart(64, '0');
}

/** ABI-encodes SwapRouter02 exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)). */
export function encodeBaseExactInputSingle(request: BaseExactInputSingleRequest): string {
  const tokenIn = address(request.tokenIn, 'tokenIn');
  const tokenOut = address(request.tokenOut, 'tokenOut');
  if (tokenIn === tokenOut) throw new Error('tokenIn and tokenOut must be different');
  if (!Number.isInteger(request.fee) || !ALLOWED_FEE_TIERS.has(request.fee) || BigInt(request.fee) > UINT24_MAX) {
    throw new Error('Unsupported Uniswap v3 fee tier');
  }
  const amountIn = uint(request.amountIn, 256, 'amountIn', false);
  const amountOutMinimum = uint(request.amountOutMinimum, 256, 'amountOutMinimum', false);
  const sqrtPriceLimitX96 = uint(request.sqrtPriceLimitX96 ?? 0n, 160, 'sqrtPriceLimitX96');
  return EXACT_INPUT_SINGLE_SELECTOR + [
    addressWord(tokenIn, 'tokenIn'),
    addressWord(tokenOut, 'tokenOut'),
    word(BigInt(request.fee)),
    addressWord(request.recipient, 'recipient'),
    word(amountIn),
    word(amountOutMinimum),
    word(sqrtPriceLimitX96),
  ].join('');
}

function hexToBytes(value: string, field: string): Uint8Array {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error(`${field} must be even-length 0x-prefixed hex bytes`);
  const hex = value.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bigintBytes(value: bigint, field: string): Uint8Array {
  uint(value, 256, field);
  if (value === 0n) return new Uint8Array();
  let hex = value.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return hexToBytes('0x' + hex, field);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function lengthBytes(length: number): Uint8Array {
  let hex = length.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return hexToBytes('0x' + hex, 'RLP length');
}

function rlpBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  if (bytes.length <= 55) return concatBytes([new Uint8Array([0x80 + bytes.length]), bytes]);
  const len = lengthBytes(bytes.length);
  return concatBytes([new Uint8Array([0xb7 + len.length]), len, bytes]);
}

function rlpList(items: Uint8Array[]): Uint8Array {
  const payload = concatBytes(items);
  if (payload.length <= 55) return concatBytes([new Uint8Array([0xc0 + payload.length]), payload]);
  const len = lengthBytes(payload.length);
  return concatBytes([new Uint8Array([0xf7 + len.length]), len, payload]);
}

function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Serializes an unsigned EIP-1559 transaction (type 0x02) for Base's
 * GasPriceOracle getL1Fee(bytes). No signature fields are present.
 */
export function serializeUnsignedBaseEip1559Transaction(tx: UnsignedEip1559Transaction): string {
  if (tx.chainId !== BigInt(BASE_CHAIN_ID)) throw new Error('Unsigned transaction must target Base mainnet (chain ID 8453)');
  const nonce = uint(tx.nonce, 256, 'nonce');
  const priority = uint(tx.maxPriorityFeePerGas, 256, 'maxPriorityFeePerGas');
  const maxFee = uint(tx.maxFeePerGas, 256, 'maxFeePerGas', false);
  const gasLimit = uint(tx.gasLimit, 256, 'gasLimit', false);
  const value = uint(tx.value, 256, 'value');
  if (priority > maxFee) throw new Error('maxPriorityFeePerGas cannot exceed maxFeePerGas');
  const to = hexToBytes(address(tx.to, 'to'), 'to');
  const data = hexToBytes(tx.data, 'data');
  const fields = [
    rlpBytes(bigintBytes(tx.chainId, 'chainId')),
    rlpBytes(bigintBytes(nonce, 'nonce')),
    rlpBytes(bigintBytes(priority, 'maxPriorityFeePerGas')),
    rlpBytes(bigintBytes(maxFee, 'maxFeePerGas')),
    rlpBytes(bigintBytes(gasLimit, 'gasLimit')),
    rlpBytes(to),
    rlpBytes(bigintBytes(value, 'value')),
    rlpBytes(data),
    new Uint8Array([0xc0]), // empty access list
  ];
  return '0x02' + bytesToHex(rlpList(fields)).slice(2);
}
