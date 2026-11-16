# Base L1 data-fee oracle adapter

## What this adds
- Read-only call to the Base GasPriceOracle predeploy at `0x420000000000000000000000000000000000000F`.
- ABI encoding for `getL1Fee(bytes)`.
- Chain ID verification (Base mainnet, 8453).
- Returns the L1 fee in wei and records the byte length and quote timestamp.
- Unit tests for ABI selector, dynamic-bytes offset, length, padding, and invalid input.

## Important input requirement
Base's `getL1Fee(bytes)` expects a **fully serialized unsigned RLP transaction**, not raw router calldata. This module intentionally requires the serialized transaction as an input. It does not create swap calldata, construct or serialize transactions, sign, broadcast, or persist anything.

The current Base QuoterV2 feature does not yet produce a trusted router transaction. Therefore this adapter is a building block only and is **not wired into the quote's total-fee field**. Existing quote results must continue to report `l1DataFeeUsd: null` and `feeEstimateComplete: false`.

## Next integration gate
Add a reviewed read-only route builder that produces the exact intended router transaction fields and unsigned RLP serialization. Then pass those bytes to this oracle, independently estimate L2 gas for the actual router call, and convert both fee components to USD using a timestamped ETH/USD reference. Do not substitute QuoterV2 call data for router transaction bytes.

## Safety
- No private keys, wallet, approvals, signer, signing, or broadcast.
- No database writes, position creation, or balance changes.
- Base paper trading remains disabled.
- This adapter does not establish profitability or route safety.

## References
- Optimism protocol predeploy specification: https://github.com/ethereum-optimism/specs/blob/main/specs/protocol/predeploys.md
- Base GasPriceOracle interface and transaction fee guidance: https://basehub.org/network/network-fees/
