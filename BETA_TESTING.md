# Beta testing guide

The beta runs **in simulation only**: real DexScreener / Jupiter market data, paper fills, and no transactions signed. Your paper account starts at `SIM_STARTING_BALANCE_USD` (default $10,000).

1. **Sign up** with your email at `/signup` (an invite code is needed only if the operator set `BETA_INVITE_CODE`).
2. **Terms & Conditions:** scroll to the end, tick "I have read the entire Terms and Conditions", then Accept.
3. **Risk Disclaimer:** read it, then press Acknowledge.
4. **Wallet:** create a wallet in your browser (write down the 12 words; they are shown once), confirm the requested words, and set a password. You can also import an existing wallet. The wallet stays encrypted in your browser; the server stores only your public address. It is not used for paper trading.
5. **App (`/app`)**: use the bottom tabs. In **Config**, set your paper capital, hours, aggression, SL/TP and daily limits, then press **Start Simulation**. **Simulate** shows live positions (close any of them), **Chart** shows real-time candles with your trades marked, **Dev Wallet** inspects any address, and **Community** is the tester chat (be nice; admins moderate).
6. **Engine console (`/`):** equity, PnL, open and closed positions, the scanner, signal weights, logs, world events, the journal and the kill switch. Use "Pause" or "Reset paper account" any time.
7. **Talk to Cletus** at `/brain`: ask "how are you doing?", "why did you buy X?", "what did you learn?" or "what's happening in the world?". He is advisory only and will refuse to execute trades.
8. **Feedback / Bug**: use the button in the header and include what you did, what you expected and what happened. Screenshots are welcome.

What to test: onboarding gate edge cases, dashboard accuracy, kill switch behaviour, Brain answers versus the dashboard numbers, and anything confusing in the disclaimers.

Operators: re-acceptance is forced by bumping `NEXT_PUBLIC_TERMS_VERSION`. Admins are set with `ADMIN_EMAILS` (otherwise the first sign-up is the admin).
