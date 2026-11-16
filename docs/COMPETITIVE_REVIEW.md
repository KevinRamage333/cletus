# Cletus competitive review (November 2026)

This is a representative feature/architecture benchmark, not a claim to have exhaustively reviewed every trading bot. Vendor feature claims are not evidence of profitable performance. Re-check current pricing, availability, and terms before integrating any provider.

## Main comparison

| Product | Strongest documented capability | What Cletus should learn | Important difference / limitation |
|---|---|---|---|
| Hummingbot | Open-source connector framework spanning CEX, on-chain order books, and AMM/DEX connectors; standardized venue interfaces. | Treat each chain/venue as a separately tested adapter; standardize order/quote and portfolio interfaces. | Primarily a trading framework and strategy toolkit; broad connector count does not prove strategy edge. |
| Freqtrade / FreqAI | Open-source strategy research, dry-run, backtesting, hyperparameter optimization, and adaptive ML tooling. | Strengthen walk-forward tests, out-of-sample validation, and model/strategy evaluation. | Primarily exchange-market workflows; users still need to supply a strategy and manage execution/risk. |
| 3Commas / QuantPilot | AI-assisted market research and agentic strategy creation, backtesting, optimization, and automation. | Natural-language strategy authoring should produce reproducible, testable strategy specs, not opaque prompts. | A hosted product; its marketing claims do not establish net profitability for any user's account. |
| Banana Gun | Unified multi-chain trading interface, including Solana, Ethereum, BNB Chain, Base and additional chains; copy trading, DCA and multi-hop routing. | Multi-chain wallet/position UX and chain-specific execution routing are table stakes, not a unique differentiator. | Primarily a fast execution/trading terminal and automation product, not a demonstrated cross-chain research/risk brain. |
| Trojan | Solana-native trading terminal with market orders, limit/DCA, copy trading, sniper tools, wallet analysis and token audits. | Token safety, wallet behavior, launch discovery, and fast on-chain data are critical for micro-cap trading. | Solana-focused; fast copying/sniping has adverse selection risk and does not prove the copied wallet remains profitable after delay/fees. |
| Coinbase for Agents | Agent connectivity to Coinbase with scoped controls, trade limits, optional approval, and MCP-compatible integrations. | AI tools need least-privilege permissions, spending boundaries, and user-visible approval controls. | An agent integration to a venue, not a complete independent strategy or multi-chain trading engine. |

## Sources

- Hummingbot connector architecture and supported venue types: https://hummingbot.org/exchanges/
- Freqtrade features and dry-run/backtesting/FreqAI: https://github.com/freqtrade/freqtrade
- 3Commas QuantPilot agentic strategy research and execution: https://3commas.io/blog/quantpilot-is-now-live
- Banana Gun unified multi-chain bot announcement: https://blog.bananagun.io/blog/banana-gun-launches-unified-telegram-trading-bot-one-interface-every-chain-every-tool
- Trojan feature set and copy trading docs: https://docs.trojan.com/terminal-overview/tools-and-widgets/copy-trading-bot
- Coinbase for Agents controls and agent connectivity: https://www.coinbase.com/agents

## Cletus differentiation target

Cletus should not try to win by claiming "AI" or by supporting the most networks. Those are easy claims to copy. The credible differentiation target is a **chain-neutral, evidence-gated research and risk engine**:

1. One asset identity and normalized market-event model across EVM, Solana, and Sui.
2. Separate strategies for newly launched/micro-cap tokens and established assets.
3. A unified ranker that compares opportunities only after gas, swap fees, liquidity impact, slippage, and failure probability.
4. A token/wallet/contract risk graph that can veto unsafe assets before the strategy evaluates entry.
5. Global risk and capital allocation across all chains, not independent bots that can unknowingly overexpose the same portfolio.
6. An auditable learning loop: every strategy change is versioned, evaluated on chronological out-of-sample data, and rejected unless it improves net results with adequate sample size.
7. Transparent explanations for every trade and every skipped opportunity.

## Competitive gaps Cletus must close

- The current engine is Solana-specific and imports Solana discovery, audit, price, quote, and execution modules directly.
- Current position identity lacks a network field; this must be fixed before multi-chain positions can safely coexist.
- The current Brain is advisory-only, which is appropriate for safety, but it needs structured strategy research outputs and should not become an unconstrained signer.
- The current backtest report says no tested entry configuration had positive out-of-sample expectancy after costs on a short, biased sample. That is the top priority, not a cosmetic dashboard.
- Multi-chain support is only a foundation on this branch. No EVM or Sui adapter is yet production- or paper-ready.

## Build priority

1. Prove or replace the strategy on Solana using better data and honest costs.
2. Add Base as the first EVM paper adapter, then Ethereum, BNB Chain, Arbitrum, Polygon, and Avalanche.
3. Add Sui with a native adapter and identifier model.
4. Unify portfolio risk and analytics only after adapter outputs are normalized and tested.

**No vendor feature list, benchmark, or AI label should be interpreted as a return forecast.**
