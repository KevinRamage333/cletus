# Base read-only market data adapter — hardened implementation

## Purpose
Collect Base token discovery candidates and normalized pair snapshots from DexScreener. Discovery and liquidity are research inputs, not buy signals.

## Validation and correctness
- Accept only Base-chain records and syntactically valid 20-byte EVM addresses.
- Deduplicate token and pair addresses case-insensitively.
- Preserve missing/invalid prices as null; never coerce them to zero.
- Reject quote-side token matches because DexScreener `priceUsd` describes the pair's base token.
- Validate numeric fields and allow only HTTPS pair URLs.
- Select a candidate pair by highest liquidity, then 24-hour volume. Do not use a blended score with arbitrary unit weighting.
- Ignore unpriced or zero-liquidity pairs when selecting a candidate.

## Reliability
- Discovery feeds may partially fail; use successful feeds and fail only when all discovery feeds fail.
- Pair requests are bounded to at most 30 addresses per provider request.
- Requests time out after 10 seconds; successful responses are cached in-process for 30 seconds.
- A failed pair batch fails the snapshot rather than silently presenting incomplete data as complete.

## Safety boundary
Read-only market data only. No swap quote, gas estimate, paper fill, database write, position mutation, signer, transaction broadcast, or live trading. Base remains disabled in the network registry.

## Validation
The focused unit suite covers invalid addresses, cross-chain data, duplicate pairs, malformed numeric fields, unsafe URLs, quote-side orientation, candidate ranking, and unpriced/illiquid pairs. CI must pass the complete test suite and TypeScript typecheck before this branch is merged.
