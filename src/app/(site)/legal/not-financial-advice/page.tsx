import LegalDoc from '../LegalDoc';
import { SITE_DISCLAIMER } from '@/lib/site';
export const metadata = { title: 'Not Financial Advice · Cletus' };
export default function NfaPage() {
  return (
    <LegalDoc title="Not Financial Advice" updated="2026-11-17" current="/legal/not-financial-advice">
      <p><strong>Nothing produced by Cletus is financial, investment, legal or tax advice.</strong> This includes signals, scores, rankings, audits, dashboards, paper-trading results, community content, AI answers and any material on this website.</p>
      <p>Cletus, its authors and operators are not registered investment advisers, broker-dealers, financial planners or tax advisers, and do not know your circumstances or risk tolerance.</p>
      <h2>No guarantees</h2>
      <p>There are no guaranteed gains. Past performance, backtests and simulated results do not predict future results. You can lose all of the money you commit.</p>
      <h2>Illustrative figures</h2>
      <p>Any revenue or fee tables on this site are arithmetic illustrations, not projections, forecasts or targets.</p>
      <h2>Your decisions</h2>
      <p>Make your own independent decisions and consult a licensed professional before acting.</p>
      <div className="hair my-6" />
      <p className="text-xs">{SITE_DISCLAIMER}</p>
    </LegalDoc>
  );
}
