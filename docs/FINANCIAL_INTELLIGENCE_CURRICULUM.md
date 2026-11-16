# Cletus Financial Intelligence Curriculum

**Version:** 1.0.0  
**Purpose:** Define the knowledge and demonstrated competencies Cletus must develop to reason about finance at a rigorous graduate level.

This curriculum is an engineering specification, not an accredited degree, professional license, or promise of investment performance. Cletus must demonstrate competence through reproducible calculations, evidence-backed case studies, and independently scored assessments.

## Learning standard

For every subject, Cletus must be able to:
- Explain core concepts accurately and in context.
- Perform calculations with units, formulas, assumptions, and reproducible inputs.
- Analyze real or historical cases using timestamped, attributable data.
- Compare competing explanations and state uncertainty and limitations.
- Identify when information is missing, stale, jurisdiction-specific, or outside its competence.
- Retain validated knowledge with source, date, confidence, and version provenance.

A subject is not mastered because a model says it understands it. The initial competency threshold is **85% on an evidence-linked assessment**, with no critical error in risk, accounting integrity, or data interpretation. Assessments should include calculation, application, and explanation—not only multiple-choice recall. Reassess periodically and after material curriculum changes.

## I. Core foundational subjects

### 1. Accounting and financial statements
Balance sheets; income statements; cash-flow statements; accrual accounting; revenue recognition; working capital; liquidity, solvency, profitability, margins, leverage, cash conversion; reconciliation; accounting estimates and limitations. Cletus must translate financial reporting into decisions without confusing earnings with cash.

### 2. Economics
Microeconomics; supply and demand; elasticity; incentives; market structures; GDP; inflation; employment; productivity; fiscal and monetary policy; interest rates; central banks; liquidity and credit cycles; macroeconomic transmission to asset prices.

### 3. Statistics and mathematical methods
Algebra and logarithms; time value of money; compounding and discounting; probability and distributions; sampling; confidence intervals; hypothesis testing; regression; correlation and covariance; return and volatility; drawdown; tail risk; statistical significance; backtest bias, leakage, overfitting, and survivorship bias.

## II. Core finance disciplines

### 4. Corporate finance
Capital structure; cost of capital; WACC; capital budgeting; NPV and IRR; valuation; discounted cash flow; budgeting; cost control; working capital; dilution; fundraising; financial governance and capital allocation.

### 5. Investments and portfolio management
Security analysis; asset classes; portfolio construction; asset allocation; diversification; CAPM and beta; efficient-frontier concepts; factor exposures; risk-return tradeoffs; rebalancing; benchmarks; performance attribution; fees and liquidity.

### 6. Financial markets and institutions
Banking and money markets; equity and debt markets; exchanges; brokers; custodians; clearing and settlement; yield curves; credit spreads; market microstructure; central banks; counterparty risk; custody; regulatory and compliance issue-spotting.

### 7. Derivatives and quantitative finance
Forwards; futures; options; swaps; payoff diagrams; margin and collateral; no-arbitrage; put-call parity; option pricing; Greeks; volatility surfaces; hedging; basis risk; stochastic-process foundations; model assumptions and model risk.

### 8. Personal finance and planning
Budgeting; emergency reserves; debt; insurance; retirement; wealth management; compounding; fees; inflation; taxes; suitability; jurisdictional limits; and referral to qualified professionals when personal circumstances require it.

## III. Advanced specializations

### 9. FinTech, blockchain, and digital assets
Digital payments; tokenization; wallets; custody; consensus; smart contracts; DeFi; stablecoins; on-chain liquidity; token economics; protocol revenue; market structure; bridges; oracles; MEV; governance; smart-contract and operational risk.

### 10. Risk management
Market, credit, liquidity, operational, model, legal, and concentration risk; risk budgets; limits; stress testing; scenario analysis; VaR and expected shortfall limitations; drawdown controls; incident response; escalation and kill-switch design.

### 11. Real estate and energy finance
Property cash flows; capitalization rates; leverage; development and lifecycle valuation; energy commodity markets; futures curves; supply and demand; project economics; financing; regulatory and price sensitivities.

### 12. ESG and sustainable finance
Materiality; sustainability disclosures; transition risk; green bonds and finance; impact measurement; data quality; methodology differences; greenwashing; and the distinction between financially material analysis and values-based preferences.

## How Cletus must use this knowledge

1. **Research:** retrieve current, reputable sources and preserve publication dates and source provenance.
2. **Model:** state assumptions, units, time horizon, base/bull/bear cases, and uncertainty.
3. **Calculate:** use deterministic, tested financial functions for arithmetic and statistical calculations; never rely on fluent text generation for critical math.
4. **Challenge:** seek disconfirming evidence, alternative hypotheses, and sensitivity to assumptions.
5. **Decide:** separate analysis from authorization. Financial education never grants permission to execute a trade, move funds, or change risk limits.
6. **Learn:** compare forecasts with later outcomes, record errors, and update only when evidence supports the change.
7. **Retain:** store validated knowledge with provenance and versioning; distinguish facts, hypotheses, user preferences, and model-generated claims.

## Non-negotiable safeguards

- Never fabricate financial statements, prices, rates, citations, credentials, or calculations.
- Never treat a backtest as proof of future performance.
- Never present a forecast as certainty or promise profit.
- Never silently change a user's risk tolerance, account settings, or execution permissions.
- Never let self-improvement weaken the Guardian, kill switch, audit trail, or approval requirements.
- Flag conflicts of interest, data gaps, stale information, and material uncertainty.
- Keep education, analysis, recommendations, and execution as separate permission levels.

## Implementation status

The curriculum taxonomy is represented in `src/lib/finance-curriculum.ts`. This document defines the intended learning standard. Persistent assessment storage, retrieval-grounded teaching materials, and user-visible progress tracking are subsequent implementation work; they must be integrated with the existing database without destructive schema changes.
