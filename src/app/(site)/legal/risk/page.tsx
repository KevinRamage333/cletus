import LegalDoc from '../LegalDoc';
import { RISK_POINTS, RISK_VERSION } from '@/lib/legal';
export const metadata = { title: 'Risk Disclosure · Cletus' };
export default function RiskPage() {
  return (
    <LegalDoc title="Risk Disclosure" updated={RISK_VERSION} current="/legal/risk">
      <p>Digital assets are highly speculative. Read every point below before using Cletus in any way.</p>
      <h2>Key risks</h2>
      <ul data-testid="risk-points">{RISK_POINTS.map((r) => <li key={r}>{r}</li>)}</ul>
      <h2>Live trading is not enabled</h2>
      <p>This platform operates in simulation (paper-trading) mode. Paper results use real market prices but simulated fills; they omit real-world failures and do not predict live results.</p>
      <h2>Automated systems and AI</h2>
      <p>Signals, scores, audits and AI answers are heuristics built on third-party data. They can be wrong, late or incomplete. Technology failures, outages and data errors can occur at any time.</p>
      <h2>Tokens, staking and revenue sharing</h2>
      <p>No Cletus token, staking program or revenue-sharing arrangement is offered. Any future concept described on this site is not an offer and would require legal review, independent audits and separate disclosures.</p>
      <h2>Regulatory and tax</h2>
      <p>Laws governing digital assets change and differ by jurisdiction. You are responsible for your own compliance and taxes.</p>
    </LegalDoc>
  );
}
