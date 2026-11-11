# Operator / platform fee (0.5%)

Cletus Technologies LLC charges a **0.5% (50 basis points)** platform fee on each swap executed through Cletus. On a $100 swap that is $0.50. The fee is implemented through the [Jupiter Swap API V2 referral program](https://developers.jup.ag/docs/swap/order-and-execute): `GET /order` is called with `referralAccount` and `referralFee=50`.

This document is the one-time setup the operator must complete before live fees are actually collected. The application **does not** create on-chain accounts or sign setup transactions for you.

## How collection works

- Parameters on `/order`: `referralAccount` (your on-chain referral account) and `referralFee` (50–255 bps). Both are required together.
- Jupiter keeps **20%** of the integrator fee and charges **no separate platform fee** while referral is active. Of the 0.5% charged, 0.1% is retained by Jupiter and 0.4% is paid to Cletus Technologies LLC.
- Jupiter chooses the fee mint (priority: SOL, then stablecoins, then LSTs, then bluechips, then others). You must have a `referralTokenAccount` for each mint you expect to receive.
- If the `referralTokenAccount` for that `feeMint` is missing, the swap still executes **but without your fee** (the user still gets the swap). The `/order` response then falls back to Jupiter's default platform fee; check `feeBps` vs `platformFee.feeBps`.
- Fee range: 50 to 255 bps. Supports SPL and Token-2022 tokens.
- Env:
  - `OPERATOR_FEE_WALLET` — payout / partner wallet (default `GdDBJt1nCibTENMKnGRPoNkjaCskTXwrdF1x1UHgY7Hq`). This is **not** the referral account.
  - `OPERATOR_FEE_BPS` — default `50`. Set `0` to disable. Values 1–49 are clamped up to 50; values above 255 are clamped down to 255.
  - `OPERATOR_FEE_ON_OWNER` — default `false`. When false, swaps whose taker is `OPERATOR_FEE_WALLET` (the owner's own trades) are not charged.
  - `JUPITER_REFERRAL_ACCOUNT` (alias `OPERATOR_REFERRAL_ACCOUNT`) — the on-chain referral account. **Until this is set, live swaps will not collect the fee.** Paper fills and scoring still include 0.5% so simulations stay realistic.

## One-time on-chain setup (you do this)

Do this from a wallet you control, ideally `OPERATOR_FEE_WALLET`. It costs a small amount of SOL for account rent. This repo will not spend those funds or sign those transactions.

### Option A — Jupiter Referral Dashboard (recommended)

1. Open [https://referral.jup.ag/dashboard-ultra](https://referral.jup.ag/dashboard-ultra) (Jupiter Ultra / Swap API referral project).
2. Connect the `OPERATOR_FEE_WALLET` (or the partner wallet that should own the referral account).
3. Create a **referral account** once. Copy its address — this is `JUPITER_REFERRAL_ACCOUNT`.
4. Create a **referral token account** for at least:
   - SOL: `So11111111111111111111111111111111111111112`
   - USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
5. Add more mints later (USDT and any other fee mints you see in `/order` `feeMint`) if a swap falls back to the default platform fee.
6. Set `JUPITER_REFERRAL_ACCOUNT` in `.env.local` and in the Vercel project env for Production (and Preview if you want preview deploys to collect too), then redeploy.

The Jupiter Ultra Referral Project address (for reference) is `DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc`.

### Option B — Referral SDK

If you prefer to do it from a script on your own machine (not from this app):

```bash
npm install @jup-ag/referral-sdk
```

```typescript
import { ReferralProvider } from "@jup-ag/referral-sdk";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const wallet = /* your Keypair — do not commit this */;
const provider = new ReferralProvider(connection);
const projectPubKey = new PublicKey("DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc");

const created = await provider.initializeReferralAccountWithName({
  payerPubKey: wallet.publicKey,
  partnerPubKey: wallet.publicKey, // OPERATOR_FEE_WALLET
  projectPubKey,
  name: "cletus",
});
// send created.tx yourself, then save created.referralAccountPubKey

const mint = new PublicKey("So11111111111111111111111111111111111111112"); // then repeat for USDC
const token = await provider.initializeReferralTokenAccountV2({
  payerPubKey: wallet.publicKey,
  referralAccountPubKey: created.referralAccountPubKey,
  mint,
});
// send token.tx yourself
```

Official docs:

- [Order & Execute — Referral fees](https://developers.jup.ag/docs/swap/order-and-execute)
- [Referral Program](https://developers.jup.ag/docs/tool-kits/referral-program)
- [GET /order](https://developers.jup.ag/docs/api-reference/swap/order)

## After setup: verify

On a **non-owner** live swap, the `/order` response should echo your `referralAccount` and a `feeBps` of 50 (plus any extra recoup such as gasless). If `feeBps` falls back to Jupiter's default platform fee (often 2, 5, 10, or 50 on new tokens) and `referralAccount` is missing, the token account for that `feeMint` is probably not initialised — create it and retry.

Claim / withdraw accumulated referral-token balances from the same dashboard when you want to move them to `OPERATOR_FEE_WALLET`.
