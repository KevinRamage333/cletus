# Base SwapRouter02 route-data builder

## What this adds
- Pure ABI encoding for the Base Uniswap v3 SwapRouter02 `exactInputSingle` call.
- Uses the official Base SwapRouter02 deployment address.
- Strictly validates token addresses, recipient, supported fee tiers, amounts, and integer widths.
- Serializes unsigned EIP-1559 Base transaction envelopes (type `0x02`) with an empty access list. This produces unsigned transaction bytes suitable as input to the Base GasPriceOracle `getL1Fee(bytes)` adapter.
- Unit tests cover calldata structure, invalid inputs, transaction type, chain ID, and malformed hex.

## Important boundaries
This code only constructs bytes in memory. It does not call the router, request token approvals, estimate nonce/gas/fee fields, sign, broadcast, or save anything. The recipient is a required public address supplied by the caller; the module has no wallet access.

The unsigned transaction serializer is only as accurate as its supplied nonce, gas limit, fee caps, destination, value, and calldata. A real L1 fee estimate must use the exact final unsigned transaction envelope. The current QuoterV2 response is not a substitute for router calldata, and the current quote output must continue to report `feeEstimateComplete: false` until route simulation and both fee components are validated.

The single-hop route remains limited to Uniswap v3 fee tiers 500, 3000, and 10000 and native Base USDC as the settlement asset in the current quote path. This does not establish token safety, approval state, executable liquidity, or profitability.

## Verified deployment reference
Base SwapRouter02: `0x2626664c2603336E57B271c5C0b26F421741e481`.

Source: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments

## Safety
- No private keys, wallet, signing, approvals, transaction submission, database writes, or balance changes.
- Base paper trading remains disabled.
