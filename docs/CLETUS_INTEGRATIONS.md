# Cletus integrations

Cletus uses its deployment connections and server-side adapters. A ChatGPT plugin installation does not issue Cletus credentials or attach that tool to its Brain.

| Service | Repo role |
| --- | --- |
| GitHub | Source, reviews and CI. |
| Vercel | Production site, previews and scheduled paper worker. |
| Neon | Separate production and sandbox databases. |
| OKX | Public USDT spot reference in the Brain. Existing wallet UI is separate. |
| Bybit | Public USDT spot reference in the Brain. |
| OpenAI Developers | Development tools. Provider credentials and an application adapter are separate. |
| Render, Linear, PostHog | Hosting, project tracking and analytics. Each service needs project-specific setup where used. |
| Stripe | Billing integration requires a Cletus account, products and verified application webhooks. |
| Figma, fal | Design files and Grove assets. Assets enter through the design or content workflow. |
| Firecrawl, Context7 | Research and documentation tools used during development. |
| Massive, TickerLayer | Market data candidates. Verify API access, usage terms and coverage before wiring. |
| CryptoAudit, TraderSpy, TradingCursor | Research candidates. Runtime API access and data contracts are unverified. |
| 3Min API, Grow My Website | Development and site operations candidates. Runtime access is unverified. |

Exchange references report venue, pair, value, and provider timestamp. They do not feed the paper order simulator or live execution and never require wallet or trading credentials.
