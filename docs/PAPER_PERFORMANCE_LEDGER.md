# Paper performance ledger

The /app/performance view reports paper-book equity, realized and unrealized P&L, win rate, profit factor, maximum drawdown, Sharpe estimate, 24-hour activity and recorded fees. It includes a reconstructed closed-trade equity progression, signal-tag attribution, current open positions and recent closed trades.

The API analyzes at most the latest 5,000 closed positions for sequence-dependent scorecard calculations and states the coverage/truncation explicitly. The recent-trades table is limited to 50. Metrics are based on recorded Position rows; this is an accounting/measurement surface, not a claim of independently verified execution quality. Signal attribution is descriptive, not causal.

The UI refreshes every 15 seconds. All data is scoped to the authenticated user's resolved account. No wallet signing or live order submission is added.
