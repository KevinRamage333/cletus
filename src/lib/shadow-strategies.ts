export type ResearchNetwork = 'solana' | 'base' | 'bsc' | 'ethereum';

const EVIDENCE_LABELS = {
  freshMarket: 'fresh market observation',
  liquidity: 'minimum pool depth',
  audit: 'token safety audit',
  shadowExit: 'executable shadow sell quote',
  costBudget: 'round-trip fees and slippage within the configured budget',
  entry: 'entry signal confirmed',
  graduation: 'verified launchpad migration',
  pullback: 'confirmed pullback',
  walletFlow: 'verified wallet flows',
  narrative: 'timestamped narrative evidence',
  creatorActivity: 'verified creator or social activity',
  catalyst: 'independently recorded catalyst',
  liquidityLock: 'verified liquidity lock or burn',
  launchActivity: 'verified launchpad activity',
  taxAndSell: 'token tax and simulated sell checks',
  sessionWindow: 'configured session window',
  established: 'established pool history',
  volume: 'volume confirmation',
  protectedRoute: 'protected route available for shadow estimation',
  positionCap: 'paper position and exposure caps',
} as const;

type Evidence = Partial<Record<keyof typeof EVIDENCE_LABELS, boolean>>;
type Profile = { id: string; label: string; exit: string; requires: readonly (keyof Evidence)[] };

const COMMON = ['freshMarket', 'liquidity', 'audit', 'shadowExit', 'costBudget', 'entry', 'positionCap'] as const;
const PROFILES: Record<ResearchNetwork, readonly Profile[]> = {
  solana: [
    { id: 'curve-graduation', label: 'Bonding-curve graduation', exit: 'Migration or time stop', requires: ['graduation'] },
    { id: 'post-graduation-dip', label: 'Post-graduation dip', exit: 'Liquidity deterioration or time stop', requires: ['graduation', 'pullback'] },
    { id: 'delayed-wallet-follow', label: 'Delayed wallet flow', exit: 'Tracked wallet sale or time stop', requires: ['walletFlow'] },
    { id: 'solana-narrative', label: 'Narrative rotation', exit: 'Strict time stop', requires: ['narrative'] },
    { id: 'small-bet-partials', label: 'Small positions with partial exits', exit: 'Hard stop and partial take-profits', requires: [] },
  ],
  base: [
    { id: 'creator-momentum', label: 'Creator and social momentum', exit: 'Short time stop', requires: ['creatorActivity', 'volume'] },
    { id: 'established-base-dip', label: 'Established-pool pullback', exit: 'Liquidity deterioration or time stop', requires: ['established', 'pullback'] },
    { id: 'base-agent-rotation', label: 'AI and agent narrative rotation', exit: 'Narrative fade or time stop', requires: ['narrative'] },
    { id: 'base-catalyst', label: 'Listing or on-ramp catalyst', exit: 'Catalyst event or time stop', requires: ['catalyst'] },
    { id: 'locked-liquidity-swing', label: 'Locked-liquidity pullback', exit: 'Trailing stop', requires: ['liquidityLock', 'pullback'] },
  ],
  bsc: [
    { id: 'four-meme-migration', label: 'Four.meme migration', exit: 'Migration-window time stop', requires: ['graduation', 'taxAndSell'] },
    { id: 'launchpad-activity', label: 'Launchpad activity', exit: 'Activity fade or time stop', requires: ['launchActivity', 'taxAndSell'] },
    { id: 'bnb-attention-scalp', label: 'Exchange-ecosystem attention', exit: 'Short time stop', requires: ['narrative', 'taxAndSell'] },
    { id: 'bnb-session', label: 'Session-window setup', exit: 'Session end or time stop', requires: ['sessionWindow', 'taxAndSell'] },
  ],
  ethereum: [
    { id: 'deep-pool-swing', label: 'Deep-pool swing', exit: 'Trailing stop or time stop', requires: ['established', 'protectedRoute'] },
    { id: 'eth-catalyst', label: 'Event catalyst', exit: 'Catalyst event or time stop', requires: ['catalyst', 'protectedRoute'] },
    { id: 'eth-volume-breakout', label: 'Volume-confirmed breakout', exit: 'Volatility-adjusted stop or time stop', requires: ['volume', 'protectedRoute'] },
    { id: 'eth-whale-flow', label: 'Whale accumulation and outflows', exit: 'Flow reversal or time stop', requires: ['walletFlow', 'protectedRoute'] },
  ],
};

export function evaluateShadowStrategies(network: string, evidence: Evidence) {
  if (!Object.prototype.hasOwnProperty.call(PROFILES, network)) return [];
  const profiles = PROFILES[network as ResearchNetwork];
  return profiles.map(({ id, label, exit, requires }) => {
    const missing: string[] = [];
    const blocked: string[] = [];
    for (const key of [...COMMON, ...requires]) {
      if (evidence[key] === false) blocked.push(EVIDENCE_LABELS[key]);
      if (evidence[key] === undefined) missing.push(EVIDENCE_LABELS[key]);
    }
    return {
      id, label, exit, missing, blocked,
      status: blocked.length ? 'blocked' as const : missing.length ? 'missing_evidence' as const : 'ready_for_shadow_test' as const,
    };
  });
}

export type ShadowStrategy = ReturnType<typeof evaluateShadowStrategies>[number];
