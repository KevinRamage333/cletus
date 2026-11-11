/**
 * Canonical Cletus whitepaper copy. The /whitepaper page, the downloadable PDF,
 * and tests all read from this module so the public text stays in one place.
 *
 * Hard rules for this text: no profitability or return claims, no guaranteed-earnings
 * language, no SEC/regulatory-compliance claims, no invented token or tokenomics,
 * no fabricated statistics. The trading strategy is experimental.
 */
import { COMPANY_LEGAL, COMPANY_NAME, FORMATION_PENDING } from './company';

export const WHITEPAPER_VERSION = '1.0';
export const WHITEPAPER_DATE = 'November 2026';
export const WHITEPAPER_TITLE = 'Cletus Whitepaper';
export const WHITEPAPER_TAGLINE = 'An experimental, non-custodial AI trading system — beginning on Solana.';
export const WHITEPAPER_PDF_PATH = '/cletus-whitepaper.pdf';

export type WpList = { type: 'ul'; items: string[] };
export type WpPara = { type: 'p'; text: string };
export type WpCallout = { type: 'callout'; text: string };
export type WpBlock = WpPara | WpList | WpCallout;

export interface WpSection {
  id: string;
  title: string;
  blocks: WpBlock[];
}

export interface WpPhase {
  id: string;
  phase: string;
  name: string;
  status: string;
  gate: string;
  body: string;
}

export const WHITEPAPER_ABSTRACT =
  'Cletus is experimental software that scans Solana token markets, scores candidates, applies safety and risk checks, and can prepare swaps for a user to approve in their own wallet. It is built and operated by ' +
  COMPANY_LEGAL +
  '. This document describes how the system works today, the 0.5% platform fee, the non-custodial design, and a phased roadmap for other networks and, later, stocks and forex. It is not an offer of a token, not financial advice, and not a promise of profit.';

export const PHASES: WpPhase[] = [
  {
    id: 'solana',
    phase: 'Phase 1',
    name: 'Solana',
    status: 'Live now, in beta',
    gate: 'The current product surface. Later phases wait on this one.',
    body:
      'Solana is the only network Cletus trades on today. The public site is a simulation-first beta: real market data, paper fills, and a working Brain, scanner, and dashboard. Live execution, when a user enables it and approves each swap, runs through Jupiter on Solana. This phase is experimental. Historical tests of the current scoring rules have not shown a profitable edge after costs. Expansion does not begin until Solana is proven under live conditions, with an honest record that justifies going further. That proof does not exist today.',
  },
  {
    id: 'base',
    phase: 'Phase 2',
    name: 'Base',
    status: 'Planned',
    gate: 'Opens only after Solana is proven profitable, with risk controls and custody rules that still hold up in live use.',
    body:
      'Base is the next network on the owner’s roadmap. The design is meant to carry over: a scanner, safety checks, and a DEX aggregator in place of Jupiter (for example 0x or 1inch), with users still connecting their own wallets and approving their own swaps. No Base integration is shipping in this beta, and no date is attached.',
  },
  {
    id: 'ethereum',
    phase: 'Phase 3',
    name: 'Ethereum',
    status: 'Planned',
    gate: 'Opens only after Base is operating reliably, and only if Solana has remained proven.',
    body:
      'Ethereum would follow Base, again through a DEX aggregator and a non-custodial wallet flow. Gas, liquidity, and token standards differ from Solana, so this phase is a new engineering and risk project, not a copy-paste of Phase 1. It is not available today.',
  },
  {
    id: 'networks',
    phase: 'Phase 4',
    name: 'Robinhood Chain and all other networks',
    status: 'Planned',
    gate: 'Opens only after Ethereum is operating reliably, and only if earlier phases still meet their quality gates.',
    body:
      'The intended order after Ethereum is Robinhood Chain, then other networks such as BNB Smart Chain (BSC) and Arbitrum. Each chain would need its own wallet support, routing, and safety review. Listing a network here is a statement of direction, not a launch, a partnership, or a promise that a given chain will ship.',
  },
  {
    id: 'tradfi',
    phase: 'Phase 5',
    name: 'Stocks and forex',
    status: 'Planned',
    gate: 'Opens only after the crypto-network phases are proven, and only after the required licenses, brokers, and legal review are in place.',
    body:
      'Stocks and forex are the last phase on this roadmap. They are subject to different — and often stricter — licensing, registration, and broker requirements than crypto-asset software. Cletus is not a broker-dealer, introducing broker, commodity trading advisor, futures commission merchant, or investment adviser, and this whitepaper is not an offer of those services. Any later expansion into stocks or forex would require appropriate licenses or registrations where they apply, regulated brokers or venues, and independent legal review. No date is attached, and none of this is available today.',
  },
];

export const SECTIONS: WpSection[] = [
  {
    id: 'vision',
    title: '1. Vision',
    blocks: [
      {
        type: 'p',
        text: 'Cletus is meant to be a careful, inspectable trading assistant — a “golden goose” in name and in brand, not a claim that it lays golden eggs. The long-term idea is a self-learning, self-healing system you can talk to: it watches markets, explains what it sees, keeps a journal of its own trades, and stays within risk rules you can configure. It begins on Solana because that is the market the software is actually built for today.',
      },
      {
        type: 'p',
        text: 'The vision is also modest in the ways that matter legally and financially. Cletus is software, not a fund, not a bank, and not a person. It does not take custody of user assets. It does not issue a token. It does not promise income. If the system cannot show an honest, durable edge on Solana, later phases stay on paper. That is a feature of the roadmap, not a footnote.',
      },
    ],
  },
  {
    id: 'how',
    title: '2. How Cletus works',
    blocks: [
      {
        type: 'p',
        text: 'A scan cycle discovers Solana tokens, filters them, scores them, runs a safety audit, and — if the account is allowed to trade — proposes or prepares an entry. Open positions are watched for exits. The Brain can explain the current state but cannot place, cancel, or size a trade. The pieces below are the ones that ship in the beta; they are experimental and can be wrong.',
      },
    ],
  },
  {
    id: 'brain',
    title: '2.1 The AI Brain',
    blocks: [
      {
        type: 'p',
        text: 'The Brain is a conversational layer over live system state. Google Gemini is the primary provider (the default model path, with automatic fallback if a configured model is retired). xAI Grok is the fallback when Gemini is unavailable or rate-limited. If neither key is usable, a deterministic offline mock still answers from the same read-only tools so the product degrades instead of going silent.',
      },
      {
        type: 'p',
        text: 'The Brain is advisory only. It has read-only tools for positions, recent trades, signal weights, configuration, scan candidates, news, its own journal, and related research features such as social hype or whale activity when those feeds are on. It has no tool that signs or submits a swap. Requests to execute a trade are refused. Answers can be inaccurate or outdated. Nothing the Brain says is investment, legal, or tax advice.',
      },
    ],
  },
  {
    id: 'scanner',
    title: '2.2 The market scanner',
    blocks: [
      {
        type: 'p',
        text: 'Cletus discovers Solana tokens from DexScreener-style market data (with additional search queries to widen the universe) and ranks candidates by 24-hour volume relative to market cap. Before a token is eligible it must also clear basic market-structure filters, including pool liquidity of at least $50,000, 24-hour volume of at least 20% of market cap (and a USD volume floor), a minimum token age of six hours, and a cap on extreme one-hour moves. Qualified names receive a composite score from the signals below. A minimum score threshold applies before any trade is considered.',
      },
    ],
  },
  {
    id: 'flow',
    title: '2.3 Order flow, volume, and chart reading',
    blocks: [
      {
        type: 'p',
        text: 'Eight weighted signals, each scaled to a 0–1 range, are combined into one composite score:',
      },
      {
        type: 'ul',
        items: [
          'Volume spike — five-minute volume large relative to market cap (full score when five-minute volume exceeds 5% of market cap).',
          'Momentum — positive short-term and one-hour price change.',
          'Breakout — a sharp five-minute rise (full score above a 5% five-minute move), with partial credit for supportive one-hour trend.',
          'Velocity surge — a burst of transactions in the last five minutes versus the recent average.',
          'Buy pressure / micro-cap heat — buys as a share of recent transactions (full score when buys exceed 70% of five-minute trades).',
          'Nano-cap spike — short-term activity on very small-cap names, used only inside that band.',
          'Liquidity build — pool liquidity depth relative to market cap.',
          'Volume / market-cap ratio — longer-horizon turnover.',
        ],
      },
      {
        type: 'p',
        text: 'The point of reading buy/sell volume and short-term structure is to tell a real burst of demand from a falling knife — a name that looks busy while price is already breaking down. Social-hype divergence (described below) uses the same idea: rising chatter with falling price is treated as a warning, not a reason to buy. After each closed trade, weights of the signals that were active at entry are amplified on a win and dampened on a loss, then re-normalized with a floor so no signal is switched off. That “self-learning” step is a heuristic. It has not been shown, out of sample, to produce a profitable edge, and chasing momentum or breakouts has been a weak pattern in the tests we have run.',
      },
    ],
  },
  {
    id: 'whales',
    title: '2.4 Whale and smart-money tracking',
    blocks: [
      {
        type: 'p',
        text: 'On-chain flow comes from Helius (parsed pool events and related account data), not from scraping a block explorer. Cletus can watch automatically discovered “smart money” wallets, the token’s developer wallet when RugCheck identifies a creator, and wallets the operator adds by hand. Features include whale net flow (a whale is sized relative to pool liquidity), smart-money entries and exits, developer sells, clusters of buys from fresh wallets, and changes in top-holder concentration. Buy and sell marks from those wallets can appear on the token chart.',
      },
      {
        type: 'p',
        text: 'For entries, this flow is a confirmer or veto, not a standalone buy trigger. Veto mode defaults to shadow: the system logs what it would have blocked, and does not yet use that log to refuse entries. For open positions, a developer dump or a whale / smart-money exit can force a fast exit (this is on by default and can be turned off). These feeds are new. They have not been backtested with a long enough history to judge whether they help. They can mis-label wallets and can miss spoofed or split flow.',
      },
    ],
  },
  {
    id: 'hype',
    title: '2.5 X social hype scanning',
    blocks: [
      {
        type: 'p',
        text: 'When an official X API credential is configured, Cletus measures recent mention volume, acceleration, unique authors, and rough signs of inorganic activity for a token. It never scrapes x.com. Hype is only a confirmer or veto, never a reason to enter on its own. The scanner classifies hype-versus-price divergence, including cases such as rising hype with dominant sells (“exit liquidity”), rising hype with a falling price (a knife), price already moving with little hype, inorganic shilling, and closer confirmation. This feed is optional, budget-limited, and not a complete picture of social media. If credits or a key are missing, the rest of the system still runs without it.',
      },
    ],
  },
  {
    id: 'rugcheck',
    title: '2.6 RugCheck safety audits',
    blocks: [
      {
        type: 'p',
        text: 'Before a trade, Cletus runs a fail-closed audit. It consults RugCheck and on-chain data (via Helius, with RugCheck as a fallback for holder lists) and checks, among other things, mint and freeze authority, liquidity-lock indicators, a honeypot-style sell-route quote through Jupiter, developer-selling flags, and holder concentration (including caps on the top holder and the top ten, with pool and locker accounts excluded where possible). A compliance-style gate also looks at concentration, short-window trading velocity, and similar internal limits.',
      },
      {
        type: 'p',
        text: 'These checks are heuristics on third-party data. They can be wrong. They do not make a token safe, do not prevent rug pulls, exploits, or vanished liquidity, and they are not a claim of regulatory compliance.',
      },
    ],
  },
  {
    id: 'presets',
    title: '2.7 Risk presets',
    blocks: [
      {
        type: 'p',
        text: 'Three market-cap presets define the scanner’s hunting ground. They describe a universe of names, not an expected return:',
      },
      {
        type: 'ul',
        items: [
          'Degen — $10,000 to $500,000 market cap. The widest, most volatile band.',
          'Balanced — $250,000 to $5,000,000 market cap. The default.',
          'Safer — $5,000,000 to $50,000,000 market cap. Larger names only. “Safer” is a relative label, not a promise that losses will be small or rare.',
        ],
      },
      {
        type: 'p',
        text: 'Users can also set aggression, position size, daily loss limits, and other preferences. Server-side safety caps still apply (including a cap on how much of the pool a single position may be, how much of equity may be in one name, and total exposure). A paper-only “preset lab” can run the three bands side by side so their records can be compared. Comparison is not a performance advertisement.',
      },
    ],
  },
  {
    id: 'exits',
    title: '2.8 Stop-loss, take-profit, and fast exit',
    blocks: [
      {
        type: 'p',
        text: 'Every position is watched for a stop-loss, a take-profit, optional trailing and break-even rules, an optional partial take-profit ladder, a stale-position exit, and a time exit. Default engine percentages are configurable; accounts can set their own stop and target, and the operator’s live plan uses a 5% stop and a 20% take-profit on a single position. Stops fill at the price actually observed, including gaps through the level — not at a guaranteed stop price.',
      },
      {
        type: 'p',
        text: 'Fast exit means open positions are re-checked often: roughly every three seconds from Jupiter Price, and immediately when a Helius WebSocket subscription sees the pool trade. A developer dump or whale / smart-money exit can trigger a sell without waiting for the ordinary stop. A daily loss limit can pause new entries. A kill switch halts scanning and can close open positions. Software, networks, and venues fail; a fast exit can still be late, partial, or unsuccessful.',
      },
    ],
  },
  {
    id: 'custody',
    title: '3. Non-custodial design',
    blocks: [
      {
        type: 'p',
        text: 'Cletus does not take custody of user funds and does not hold user private keys or seed phrases. A person who wants to use the product connects their own Solana wallet — Phantom, Solflare, or Backpack, through the Wallet Standard / wallet-adapter flow — on their own volition, or they can continue in paper mode and only watch. Sign-In-With-Solana is a message signature used for authentication. It does not grant trading permission.',
      },
      {
        type: 'p',
        text: 'When a live swap is proposed, Cletus prepares an unsigned Jupiter order. The user approves that transaction in their own wallet, from an approval queue with a time limit. There are no delegated keys, no session keys, and no hidden signing on the user’s behalf. A user can disconnect at any time. The server stores a public key (or nothing, in paper mode), never a secret.',
      },
    ],
  },
  {
    id: 'jupiter',
    title: '4. Jupiter execution',
    blocks: [
      {
        type: 'p',
        text: 'Swaps are routed through the Jupiter Swap API (order and execute). In simulation, Cletus takes a keyless quote and records a paper fill that includes modelled price impact, Jupiter fees, network costs, and the Cletus platform fee, so paper results are not an idealized zero-cost path. In live mode, the unsigned order is presented to the user’s wallet (or, for the operator wallet only, signed in the trading worker). Jupiter then lands the transaction. Quotes can fail, routes can disappear, slippage can exceed what was expected, and a submitted swap can still miss or revert.',
      },
    ],
  },
  {
    id: 'fees',
    title: '5. Fees',
    blocks: [
      {
        type: 'p',
        text: 'Each swap through Cletus includes a 0.5% (50 basis points) platform fee charged by ' +
          COMPANY_NAME +
          ' and collected through the Jupiter Referral Program. On a $100 swap that is $0.50. Jupiter retains 20% of that integrator fee (0.1% of the swap); the remaining 0.4% of the swap is paid to ' +
          COMPANY_NAME +
          '. Network fees and slippage are extra. The fee is included in paper-trading results so simulations stay realistic. It is not charged on the operator’s own trades.',
      },
      {
        type: 'p',
        text: 'Live collection requires a Jupiter referral account and referral token accounts for the fee mints Cletus expects to receive (starting with SOL and USDC). If those on-chain accounts are missing, a swap may still execute without the platform fee being collected. The fee is a cost to the trader; it is not a share of profits, not a staking reward, and not tied to any token.',
      },
    ],
  },
  {
    id: 'transparency',
    title: '6. Transparency',
    blocks: [
      {
        type: 'p',
        text: 'Cletus is built to be watched, not to hide its book.',
      },
      {
        type: 'ul',
        items: [
          'Per-user live trade view — after wallet sign-in, a person can see their own open position, running profit and loss, trade history, and on-chain links (for example Solscan) for fills that landed. Other people’s wallets are not shown.',
          'Public live P&L feed — a public page and ticker for recorded, anonymized aggregate profit and loss across users, a feed of closed trades as they complete, and a win rate. Names and wallet addresses stay private unless someone opts in.',
        ],
      },
      {
        type: 'p',
        text: 'Recorded results, including simulated or paper results, do not predict future results. A public feed can be empty early in a beta, can mix paper and live prints if both exist, and should never be read as a track record that guarantees anything. When a number is shown, it is a recorded close or a clearly labeled simulation — not a sample or a projection.',
      },
    ],
  },
  {
    id: 'security',
    title: '7. Security',
    blocks: [
      {
        type: 'p',
        text: 'The security model starts with “we do not hold your keys,” and continues with ordinary software hygiene:',
      },
      {
        type: 'ul',
        items: [
          'User secrets never enter the server. Operator secrets (trading-wallet keys, RPC keys, model keys, the database) live in server environment storage, not in the client, and are not logged.',
          'Session cookies are signed, HttpOnly, and SameSite. Onboarding and APIs re-check that terms and the risk disclaimer have been accepted.',
          'The Brain cannot trade. Community posts that look like private keys or recovery phrases are rejected.',
          'RPC uses Helius as the primary endpoint and a backup (FluxRPC) with health checks and failover. URLs and keys are not exposed to the browser.',
          'A kill switch can halt the engine. Tax tools do not collect tax identification numbers.',
          'No system is perfectly secure. Wallets, devices, phishing, third-party APIs, and bugs remain the user’s and the operator’s ongoing risk.',
        ],
      },
    ],
  },
  {
    id: 'roadmap',
    title: '8. Roadmap',
    blocks: [
      {
        type: 'p',
        text: 'The roadmap is ordered, not dated. Each later phase has a milestone gate. “After Solana is proven profitable” means what it says: there must be an honest live record that supports expansion. That record does not exist today, and this document does not claim it will. Phases can be delayed, reordered, or abandoned if the evidence or the law requires it.',
      },
    ],
  },
  {
    id: 'team',
    title: '9. Team and company',
    blocks: [
      {
        type: 'p',
        text: 'Cletus is software operated by ' +
          COMPANY_LEGAL +
          (FORMATION_PENDING
            ? '. Articles of Organization are planned to be filed in Missouri in November 2026. Until filing is complete, the company should be treated as formation pending.'
            : ' It is organized in Missouri.') +
          ' References in the product Terms to “we,” “us,” or “Cletus” as a party mean that company and its software.',
      },
      {
        type: 'p',
        text: 'Cletus is not a registered investment adviser, broker-dealer, commodity trading advisor, futures commission merchant, bank, or fund manager. Nothing in this whitepaper is a registration, an application for a license, or a claim that the company is already authorized to offer brokerage, advisory, or exchange services in any jurisdiction.',
      },
    ],
  },
  {
    id: 'token',
    title: '10. No token',
    blocks: [
      {
        type: 'p',
        text: 'There is no Cletus token. This whitepaper does not introduce a token, a sale, a staking program, a points-for-equity scheme, or any tokenomics. There is no tokenomics. Pages in the product that mention staking are informational placeholders only and do not offer a stake, a purchase, or a reward. Nothing in this document is an offer to sell, or a solicitation to buy, any security, commodity interest, or investment contract.',
      },
    ],
  },
  {
    id: 'risks',
    title: '11. Risk disclosures',
    blocks: [
      {
        type: 'p',
        text: 'Trading digital assets — especially low-liquidity Solana tokens — is extremely risky. You can lose some or all of the capital you put at risk, quickly and without warning. Only use money you can afford to lose entirely.',
      },
      {
        type: 'ul',
        items: [
          'The strategy is experimental. Internal backtests of the current scoring rules have not shown a profitable edge after costs. No tested configuration was profitable out of sample. That finding is historical, limited, and not a prediction that future results will be better, worse, or the same.',
          'There are no guaranteed gains, returns, profits, income, or win rates. Past, simulated, paper, or backtested results do not predict future results.',
          'Markets gap. Liquidity can vanish. Tokens can be rugged, frozen, or unsellable. Slippage, failed transactions, network congestion, and oracle or price-feed errors can all produce a worse fill than the screen suggested, or no fill at all.',
          'Signals, audits, whale labels, and social-hype scores are heuristics. They can be wrong, late, incomplete, or gamed.',
          'Software can fail. APIs (Jupiter, Helius, DexScreener, RugCheck, X, model providers, and others) can throttle, change, or go down. A stop-loss or fast exit is not a guarantee of exit at a given price.',
          'Fees, slippage, and taxes reduce results. You are responsible for your own tax reporting. Cletus does not give tax advice.',
          'You are solely responsible for your wallet, your keys, your approvals, and your decisions. Connecting a wallet and approving a swap are voluntary.',
        ],
      },
    ],
  },
];

export const DISCLAIMER_TITLE = 'Important disclaimer';

export const DISCLAIMER_PARAS: string[] = [
  'This whitepaper is for information and education only. It is not financial, investment, legal, or tax advice. It is not an offer, solicitation, or recommendation to buy, sell, or hold any digital asset, security, or other instrument, and it is not an offer of any token.',
  'Cletus, ' + COMPANY_NAME + ', and the authors and operators of the software are not your adviser, broker, or fiduciary. They do not know your financial situation, objectives, or risk tolerance. You must make your own independent decisions and, if you need advice, consult a licensed professional.',
  'Nothing in this document, on the Cletus website, in the dashboard, in Brain chat, or in any live or historical profit-and-loss figure is a promise or guarantee of profit, income, or performance. Losses, including a total loss of capital, can and do occur. The trading strategy is experimental and has not been shown to be profitable in out-of-sample testing.',
  'This document does not claim that Cletus or ' + COMPANY_NAME + ' is registered with, approved by, licensed by, or compliant with the U.S. Securities and Exchange Commission, the Commodity Futures Trading Commission, or any other regulator. Internal risk controls are not a substitute for regulation.',
  'Digital-asset markets are volatile and largely unforgiving. If you do not understand the risks, or if you cannot afford to lose the money you would put at risk, do not use Cletus to trade live.',
  'This language is a disclosure, not a substitute for the product Terms and Risk Disclaimer, which you must read and accept before using the application. Those terms, and this whitepaper, may be updated. This is version ' + WHITEPAPER_VERSION + ' (' + WHITEPAPER_DATE + ').',
];

/** Flattened plain text for tests and PDF rendering. */
export function whitepaperPlainText(): string {
  const bits: string[] = [
    WHITEPAPER_TITLE,
    WHITEPAPER_TAGLINE,
    `Version ${WHITEPAPER_VERSION} · ${WHITEPAPER_DATE}`,
    COMPANY_LEGAL,
    WHITEPAPER_ABSTRACT,
  ];
  for (const s of SECTIONS) {
    bits.push(s.title);
    for (const b of s.blocks) {
      if (b.type === 'p' || b.type === 'callout') bits.push(b.text);
      else bits.push(...b.items);
    }
    if (s.id === 'roadmap') {
      for (const p of PHASES) bits.push(`${p.phase}: ${p.name}`, p.status, p.gate, p.body);
    }
  }
  bits.push(DISCLAIMER_TITLE, ...DISCLAIMER_PARAS);
  return bits.join('\n');
}
