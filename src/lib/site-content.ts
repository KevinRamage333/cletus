/**
 * Corporate-site copy, adapted from Cletus's project overview ("Cletus — The Autonomous Trading &
 * Financial Intelligence Ecosystem: Project Overview, Development Progress & Future Vision").
 * Every capability carries an honest status. Nothing here may claim live trading, guaranteed returns,
 * or an existing token, staking or revenue-sharing program (enforced by tests/site-content.test.ts).
 */
export type BuildStatus = 'built' | 'in-progress' | 'future';
export const STATUS_LABEL: Record<BuildStatus, string> = { built: 'Built', 'in-progress': 'In progress', future: 'Future concept' };

export const EXECUTIVE_SUMMARY = [
  'Cletus is being developed as an intelligent cryptocurrency trading and financial technology ecosystem. The goal is bigger than creating another trading bot.',
  'Cletus is designed to bring together automated market analysis, trading signals, risk management, portfolio tracking, blockchain connectivity, community intelligence, transparent financial reporting and an intelligent digital companion in one connected platform.',
  'The idea is simple: give everyday people access to a more intelligent, transparent and community-driven approach to navigating cryptocurrency markets.',
  'The long-term vision is a platform that can analyze markets, explain its decisions, help users manage risk, learn from collective market activity and become a trusted digital financial companion.',
];

export const PROBLEMS = [
  'Market information is spread across dozens of platforms.',
  'Trading signals are often difficult to verify.',
  'Many trading tools do not clearly explain their decisions.',
  'Users struggle to understand their actual profit and loss.',
  'Wallets, exchanges, analytics and communities are disconnected.',
  'New investors often lack meaningful risk-management tools.',
  'Trading communities frequently promote opinions without accountability.',
  'Automated trading systems can be difficult to trust.',
];

export interface Capability { title: string; status: BuildStatus; body: string; points: string[] }
export const WHAT_WE_BUILT: Capability[] = [
  { title: 'Application foundation', status: 'built', body: 'A multi-page application rather than a dashboard with manually entered backend settings.', points: ['Home dashboard', 'Accounts, authentication and staged onboarding', 'Wallet connection (Solana and EVM)', 'Administrative tools'] },
  { title: 'Trading intelligence', status: 'in-progress', body: 'Market-data integrations, signal infrastructure, risk logic, portfolio calculations, simulation, swap quotes and audit functionality.', points: ['DexScreener, GeckoTerminal and Jupiter integrations', 'Composite token scoring', 'Stop, take-profit and drawdown controls', 'Integration and realistic validation underway'] },
  { title: 'Paper trading', status: 'built', body: 'Practice trading with real market prices and zero real funds.', points: ['Simulated trade records', 'Account-scoped paper data', 'Buy/sell with liquidity-aware fills', 'Partial exits and realized P&L'] },
  { title: 'Portfolio & tax reporting', status: 'in-progress', body: 'Portfolio views and exportable records that help users understand what actually happened.', points: ['Paper portfolio with last-refreshed times', 'Connected-wallet balances', 'Realized gain/loss export (CSV)', 'Not tax advice'] },
  { title: 'Cletus Audit', status: 'built', body: 'Evidence-based token checks from public on-chain data.', points: ['Mint and freeze authority', 'Holder concentration', 'Liquidity and market data', 'Clear "could not verify" states'] },
  { title: 'Gold community', status: 'in-progress', body: 'A collective, privacy-conscious view of activity and market discussion.', points: ['Anonymous public labels', 'Opt-in participation and moderation', 'Aggregated collective paper P&L', 'Network coverage at a glance'] },
  { title: 'Security & administration', status: 'built', body: 'Restricted, auditable administrative actions and fail-safe defaults.', points: ['Simulation mode by default', 'Kill switch', 'Non-custodial wallet connections', 'Audit trail for moderation and approvals'] },
];

export const GOLD_COMMUNITY = [
  { title: 'Collective intelligence', body: 'See what the community is doing in aggregate, never who is doing it. Individual positions are never published.' },
  { title: 'Accountable discussion', body: 'Posts are moderated, labels are anonymous, and participation is opt-in. Opinions are separated from verified data.' },
  { title: 'Transparent results', body: 'Collective paper P&L is computed from recorded simulated trades and shows when it was last refreshed.' },
];

export interface RevenueRow { monthlyVolumeUsd: number }
export const REVENUE_FEE_BPS = 50; // 0.5% platform fee on user-approved swaps routed through Jupiter
export const REVENUE_SPLIT = { cletusPct: 80, jupiterPct: 20 } as const; // Jupiter referral program retains 20% of the integrator fee
export const REVENUE_ILLUSTRATION: RevenueRow[] = [{ monthlyVolumeUsd: 100_000 }, { monthlyVolumeUsd: 1_000_000 }, { monthlyVolumeUsd: 10_000_000 }, { monthlyVolumeUsd: 50_000_000 }];
export function revenueRow(volume: number) {
  const fee = (volume * REVENUE_FEE_BPS) / 10_000;
  return { volume, fee, cletus: (fee * REVENUE_SPLIT.cletusPct) / 100, jupiter: (fee * REVENUE_SPLIT.jupiterPct) / 100 };
}
export const REVENUE_STREAMS = [
  { title: 'Transaction fee', status: 'future' as BuildStatus, body: 'A 0.5% platform fee on swaps a user approves in their own wallet, collected through the Jupiter referral program. Not active: live trading is not enabled.' },
  { title: 'Premium intelligence', status: 'future' as BuildStatus, body: 'Advanced signals, deeper audits and research tools as optional paid tiers.' },
  { title: 'Partnerships & data', status: 'future' as BuildStatus, body: 'Integrations and sponsorships with aligned infrastructure and data providers.' },
];

export const STAKING_AND_CHAINS = {
  staking: 'Staking, token utility and any revenue-sharing mechanics are future concepts only. No Cletus token exists or is offered, no staking program is live, and any such feature would require legal and securities review, independent smart-contract audits and clear disclosures before launch.',
  networks: [
    { id: 'solana', name: 'Solana', status: 'built' as BuildStatus, note: 'Market data, audit, paper trading and wallet connection.' },
    { id: 'ethereum', name: 'Ethereum', status: 'in-progress' as BuildStatus, note: 'Wallet connection and balances. Market intelligence planned.' },
    { id: 'base', name: 'Base', status: 'in-progress' as BuildStatus, note: 'Wallet connection, balances and Base paper desk foundations.' },
    { id: 'bnb', name: 'BNB Chain', status: 'in-progress' as BuildStatus, note: 'Wallet connection and balances.' },
    { id: 'polygon', name: 'Polygon', status: 'in-progress' as BuildStatus, note: 'Wallet connection and balances.' },
    { id: 'cronos', name: 'Cronos', status: 'in-progress' as BuildStatus, note: 'Wallet connection and balances.' },
  ],
};

export const COMPANION = [
  { title: 'Cletus, the companion', status: 'in-progress' as BuildStatus, body: 'A conversational research assistant that explains market context and its own reasoning, with clear limits on what it can and cannot know.' },
  { title: 'Financial education', status: 'future' as BuildStatus, body: 'Guided learning on risk, position sizing, taxes and how markets actually behave.' },
  { title: 'Persistent experiences', status: 'future' as BuildStatus, body: 'A companion that remembers context you choose to share, with memory you control.' },
  { title: 'Virtual world', status: 'future' as BuildStatus, body: 'Research and development toward an interactive world built around Cletus. A concept, not a product.' },
];

export const TECH_STACK: Array<{ layer: string; tech: string; status: BuildStatus }> = [
  { layer: 'Web application', tech: 'Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS', status: 'built' },
  { layer: 'Data layer', tech: 'PostgreSQL (Neon) via Prisma', status: 'built' },
  { layer: 'Market data', tech: 'DexScreener, GeckoTerminal, Jupiter price & quote APIs', status: 'built' },
  { layer: 'On-chain reads', tech: 'Solana JSON-RPC (@solana/web3.js), viem for EVM networks', status: 'built' },
  { layer: 'Wallets', tech: 'Solana Wallet Adapter (Phantom, Solflare, Backpack), wagmi (MetaMask, Coinbase Wallet, injected)', status: 'built' },
  { layer: 'Execution', tech: 'Jupiter swap routing with user approval in their own wallet', status: 'in-progress' },
  { layer: 'Testing', tech: 'Vitest unit tests, Playwright end-to-end and mobile smoke tests', status: 'built' },
  { layer: 'Hosting', tech: 'Vercel (web), managed Postgres; worker processes separate from the web tier', status: 'built' },
];

export const ROADMAP_VISION =
  'Cletus is being built as an autonomous AI trader that analyzes markets, explains its decisions, and trades transparently across many chains. Live trading is not enabled. The site and engine run in simulation: paper trades against real market data, with no mock data and nothing signed. Nothing here promises or projects returns.';

export interface Phase { n: number; title: string; status: BuildStatus; items: string[] }
export const ROADMAP: Phase[] = [
  { n: 1, title: 'Shipped', status: 'built', items: ['Gold redesign of the public site and app (pull request #98)', 'Paper ledger: simulated trades on live market prices', 'Optional non-custodial Solana and EVM wallet connect', 'In-house security audit with 698 unit tests and the end-to-end suite passing'] },
  { n: 2, title: 'In progress', status: 'in-progress', items: ['Live charts on the Feed, Community and Audit screens', 'Cletus Verified for developers, and Token Boost (payments off; boosts do not affect the trading engine)', 'Real-data paper positions on the site, with no mock data', "The Owner's Desk operations dashboard", 'Launch on cletustechnology.dev, still in simulation, with live trading off'] },
  { n: 3, title: 'Next', status: 'future', items: ['Multi-network paper trading on Ethereum, Base, BNB, Polygon, Cronos and Arbitrum, only after the site is live and wallet audits pass', 'wagmi 3 upgrade, as its own stage, with the wallet end-to-end suite', 'Live trading on any network stays off until it is separately and explicitly approved'] },
  { n: 4, title: 'Agent Council', status: 'future', items: ['Charlotte, Signal & Allocation Analyst, Defender, Guardian and Operations Steward', 'Advisory and read-only: no trade execution, signing, custody or fund movement', 'A Council screen that brings the agents together; it is not shipped'] },
  { n: 5, title: 'Future vision', status: 'future', items: ['The Grove: coming, details TBA', 'GitHub Sponsors to fund engineering, testing, documentation and security work once the repository is public', 'Sponsorship is support for the project, not an investment, token sale, or share of trading results'] },
];

export const NEXT_PRIORITIES = [
  'Ship live charts on the Feed, Community and Audit screens.',
  'Finish Cletus Verified and Token Boost, with payments off and no effect on the trading engine.',
  'Show real-data paper positions on the site.',
  "Complete The Owner's Desk.",
  'Launch the site on cletustechnology.dev, still in simulation.',
  'Upgrade wagmi 3 after wallet-connect audits pass.',
  'Expand paper trading to Ethereum, Base, BNB, Polygon, Cronos and Arbitrum only after the site is live and those audits pass.',
];

export const TRUST_PRINCIPLES = [
  'Users retain control of their wallets.',
  'Private keys are never collected through application forms or shared with administrators.',
  'Financial actions require the user\u2019s own authorization.',
  'Paper trading is always clearly distinguished from live trading.',
  'Trading results are never fabricated or presented as guaranteed.',
  'Community financial information is aggregated and privacy-conscious.',
  'Administrative actions are restricted and auditable.',
  'Smart contracts and live financial systems require independent security review.',
  'Risk disclosures and legal requirements are addressed before any regulated service is offered.',
];

export const WHY_DIFFERENT = [
  { title: 'Trading intelligence', body: 'Tools to analyze markets and evaluate opportunities.' },
  { title: 'Risk management', body: 'Systems that help users understand exposure and potential losses.' },
  { title: 'Financial transparency', body: 'Clear information about trading activity and performance.' },
  { title: 'Community intelligence', body: 'A collective view of activity and market discussion.' },
  { title: 'Blockchain connectivity', body: 'A growing multi-chain foundation.' },
  { title: 'Revenue infrastructure', body: 'Potential transaction-based and premium-service revenue.' },
  { title: 'Digital companionship', body: 'A longer-term vision for a more personal, interactive experience.' },
];

export const BENEFACTOR_AREAS = [
  'Backend hosting and infrastructure', 'Security audits and penetration testing', 'Blockchain integration', 'Product engineering',
  'User experience and interface development', 'Market-data services', 'Legal and compliance consultation', 'Community launch and growth', 'Testing and operational support',
];

export const CLOSING = [
  'Cletus began with an idea: build something smarter than another trading bot.',
  'The larger vision is an ecosystem where financial intelligence, blockchain technology, community participation and artificial intelligence work together: a place where people can see what is happening, understand why, evaluate their options and participate with greater awareness.',
  'A platform that values transparency over hype, education over manipulation, and community over isolation.',
];

export const STATUS_NOTE = 'This site distinguishes existing code and infrastructure from incomplete integrations and future concepts. It does not represent Cletus as a launched live-trading platform, guarantee financial returns, or claim that future token, staking or revenue-sharing features are operational.';
