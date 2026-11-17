# Cletus Finance Academy — Foundations v1

Status: curriculum and evaluation specification. This document does not claim that Cletus has learned, passed exams, or acquired live trading competence.

## Purpose
Teach Cletus to explain and apply financial concepts with source attribution, uncertainty calibration, reproducible calculations, and paper-first validation. Never treat generated prose as evidence of mastery.

## Competency levels
0 Unknown; 1 Defines correctly; 2 Calculates correctly; 3 Applies to real or historical sourced data; 4 Defends decisions under adversarial scenarios; 5 Demonstrates reliable out-of-sample performance. Require independently graded tests for progression.

## Curriculum
1. Accounting: double entry, three statements, working capital, accruals, free cash flow, dilution, ratios.
2. Economics: supply/demand, GDP, inflation, unemployment, rates, yield curve, monetary/fiscal policy, exchange rates.
3. Corporate finance: DCF, WACC, CAPM limitations, cost of capital, leverage, capital budgeting.
4. Markets: equities, fixed income, options, futures, FX, commodities, crypto, venues, market microstructure.
5. Quantitative methods: probability, distributions, estimation, hypothesis testing, regressions, time-series leakage, uncertainty.
6. Portfolio management: diversification, correlation, beta, risk budgets, rebalancing, tail risk, drawdown.
7. Trading systems: signals, slippage, fees, spreads, latency, liquidity, order types, realistic fills.
8. Crypto/DeFi: token supply, vesting, holder concentration, AMMs, MEV, bridge and contract risks, on-chain provenance.
9. Behavioral finance: loss aversion, overconfidence, survivorship bias, confirmation bias, crowd behavior.
10. Financial integrity: fraud indicators, disclosures, manipulation avoidance, audit trails, privacy and compliance.
11. Research: causal inference, regime shifts, walk-forward evaluation, benchmark selection, strategy retirement.
12. Communication: explain hypotheses, opposing evidence, assumptions, uncertainty, and why no trade may be best.

## Evaluation protocol
For each module maintain versioned lessons, a question bank with numerical and adversarial cases, answer keys, and independent grading. Minimum 90% on held-out questions, 100% on critical safety cases, and no fabricated sources. Retest after material model/prompt/data changes. Do not put answer keys in the same inference context as questions.

## Trading readiness gates
- Paper-only by default; no real-money execution authorization from educational scores.
- Historical backtests must include fees, spreads, slippage, liquidity, rejected orders, delistings and survivorship considerations.
- Use time-ordered train/validation/test partitions and walk-forward out-of-sample checks. No lookahead or target leakage.
- Track realized/unrealized P&L, net returns, max drawdown, Sharpe (with caveats), turnover, exposure, win rate, payoff ratio, profit factor and confidence intervals.
- Require durable paper-trading records with timestamps, price source, strategy version, order/fill events and reconciliation.
- Risk guardrails: max position, portfolio exposure, daily loss, drawdown, stale-price timeout, data-source failures and manual kill switch.
- Never claim guaranteed returns or professional credentials. Present uncertainty and data provenance.

## Implementation backlog
1. Add versioned lesson content and machine-readable question bank.
2. Add deterministic accounting/math calculators with unit tests.
3. Add independent quiz runner and competency ledger.
4. Integrate research explanations with cited market data and uncertainty.
5. Add paper-trading scorecard and operational gating tests.
6. Add finance-learning dashboard with progress and failed-topic review.

## Initial sample assessments
Q: Assets 150, liabilities 90: equity? A: 60.
Q: Buy at 100, sell at 105, fees 1 each side: net P&L per unit? A: 3.
Q: 40 wins at +2, 60 losses at -1: gross P&L? A: +20 before fees.
Q: Why can 70% win rate lose money? A: Loss magnitude and trading costs may outweigh gains.
Q: Does an attractive backtest prove future profits? A: No; leakage, overfitting, regime change and execution friction can invalidate it.
