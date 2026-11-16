'use client';
import { Steps } from '../Steps';
import WalletProviders from '@/components/WalletProviders';
import ConnectWallet from '@/components/ConnectWallet';

function WalletStep() {
  return (
    <div className="center-page">
      <div className="card narrow" style={{ maxWidth: 640 }}>
        <Steps at={4} />
        <h1>Connect your wallet</h1>
        <p className="muted">Step 4 of 4 — optional, and on your own volition. You can choose paper mode instead.</p>
        <ConnectWallet mode="onboarding" />
      </div>
    </div>
  );
}

export default function WalletPage() {
  return (
    <WalletProviders>
      <WalletStep />
    </WalletProviders>
  );
}
