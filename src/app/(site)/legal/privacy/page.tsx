import LegalDoc from '../LegalDoc';
import { COMPANY_LEGAL } from '@/lib/company';
export const metadata = { title: 'Privacy Policy · Cletus' };
export default function PrivacyPage() {
  return (
    <LegalDoc title="Privacy Policy" updated="2026-11-17" current="/legal/privacy">
      <p>This policy explains how {COMPANY_LEGAL} handles information when you use the Cletus website and application.</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data</strong>: email address and onboarding acceptances (terms, risk, age attestation) with timestamps.</li>
        <li><strong>Wallet addresses</strong>: public addresses you choose to connect. We never collect private keys or seed phrases.</li>
        <li><strong>Paper-trading records</strong>: simulated trades in your account. Practice trades on the public preview stay in your browser&apos;s local storage.</li>
        <li><strong>Community content</strong>: posts you choose to publish, shown under an anonymous public label, and moderation history.</li>
        <li><strong>Technical data</strong>: basic logs needed to operate and secure the service.</li>
      </ul>
      <h2>What we do not do</h2>
      <ul><li>We do not sell personal data.</li><li>We do not publish individual positions; community financial figures are aggregated.</li><li>We do not ask for, store or transmit private keys.</li></ul>
      <h2>Third parties</h2>
      <p>Market data comes from public providers such as DexScreener and Solana RPC nodes. When your browser connects a wallet or reads a balance, requests go to that wallet and to public RPC endpoints, which have their own privacy policies.</p>
      <h2>Your choices</h2>
      <p>You can disconnect wallets at any time, clear local practice data from the app, opt out of the community, and request account deletion.</p>
      <h2>Contact</h2>
      <p>Use the contact page for privacy requests.</p>
    </LegalDoc>
  );
}
