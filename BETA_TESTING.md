# Beta testing guide

The beta runs **in simulation only**: real DexScreener / Jupiter market data, paper fills, and no transactions signed. Your paper account starts at `SIM_STARTING_BALANCE_USD` (default $10,000).

1. **Sign up** with your email at `/signup` (an invite code is needed only if the operator set `BETA_INVITE_CODE`). The sign-up screen displays the loss-risk warning.
2. **Age eligibility:** confirm you are at least 18 and legally permitted to use Cletus where you live. This is a self-attestation, not identity verification; the app stores its version and timestamp, not your date of birth.
3. **Terms & Conditions:** scroll to the end, tick "I have read the entire Terms and Conditions", then Accept.
4. **Risk disclosure:** read and acknowledge the prominent warning: the only guarantee is that you can lose money, including all funds you put at risk.
5. **Financial understanding:** complete five server-validated stages on loss risk, uncertainty, wallet security, transaction authority and independent choice.
6. **Wallet:** only after the previous steps, optionally connect a wallet you already control (Jupiter, Phantom, Solflare or Backpack) on your own volition, or choose **Just watch — paper mode**. Cletus never holds your keys. A Sign-In-With-Solana message only proves you control the address; it is not a trade. You can disconnect at any time.
7. **App (`/app`)**: use the bottom tabs. In **Config**, set your paper capital, hours, aggression, SL/TP and daily limits, then press **Start Simulation**. **Simulate** shows live positions (close any of them), **Chart** shows real-time candles with your trades marked, **Dev Wallet** inspects any address, and **Community** is the tester chat (be nice; admins moderate).
6. **Engine console (`/`):** equity, PnL, open and closed positions, the scanner, signal weights, logs, world events, the journal and the kill switch. Use "Pause" or "Reset paper account" any time.
7. **Talk to Cletus** at `/brain`: ask "how are you doing?", "why did you buy X?", "what did you learn?" or "what's happening in the world?". He is advisory only and will refuse to execute trades.
8. **Feedback / Bug**: use the button in the header and include what you did, what you expected and what happened. Screenshots are welcome.

What to test: onboarding gate edge cases, dashboard accuracy, kill switch behaviour, Brain answers versus the dashboard numbers, and anything confusing in the disclaimers.

Operators: re-acceptance is forced by bumping `NEXT_PUBLIC_TERMS_VERSION`, `NEXT_PUBLIC_RISK_VERSION`, `AGE_ATTESTATION_VERSION` in code, or `FINANCIAL_CONSENT_VERSION` in code as applicable. Admins are set with `ADMIN_EMAILS` (otherwise the first sign-up is the admin).
