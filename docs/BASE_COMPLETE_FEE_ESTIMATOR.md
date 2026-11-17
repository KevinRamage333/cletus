# Base complete transaction-fee estimator

## What this phase adds
- Connects the existing Base QuoterV2 quote to the exact single-hop SwapRouter02 calldata builder.
- Uses the caller-supplied public wallet address only as the `from` and recipient for read-only `eth_estimateGas`.
- Reads the pending nonce, current EIP-1559 base fee and priority fee from the Base RPC.
- Serializes the exact current unsigned EIP-1559 transaction envelope and passes those bytes to the official Base GasPriceOracle `getL1Fee(bytes)`.
- Reports L1 data fee plus a conservative L2 maximum-fee budget, including a 20% gas-limit buffer.
- Keeps token amounts in integer arithmetic and returns the estimate as read-only data.

## Why this is still an estimate
The L1 oracle result is exact for the unsigned transaction bytes supplied at quote time. A future transaction can differ because its nonce, fee caps, calldata, or network state may change. The L2 estimate is a conservative maximum-fee budget, not a prediction of the final charged amount.

## Wallet and approval boundary
The wallet address is public input only. No wallet is connected or controlled. `eth_estimateGas` can revert when the address lacks the token balance or allowance needed for the simulated swap. Cletus does not create approvals, sign, broadcast, or change balances.

## Explicit exclusions
- No live trading or transaction submission.
- No token approval or allowance transaction.
- No database writes, paper positions, or account balance changes.
- No multi-hop routes or non-Uniswap Base DEXs.
- No claim that a complete fee estimate proves token safety, liquidity, or profitability.

## Next validation gate
Run the complete unit suite and production build, verify the route against a controlled Base test wallet with existing approvals, and compare the fee result with a known unsigned transaction and subsequent on-chain receipt. Keep Base paper trading disabled until this validation and chain-scoped portfolio integration are complete.
