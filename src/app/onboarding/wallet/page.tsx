'use client';
import { Steps } from '../Steps';
import WalletProviders from '@/components/WalletProviders';
import ConnectWallet from '@/components/ConnectWallet';

function WalletStep() {
  return (
    <div className="center-page">
      <div className="card narrow" style={{ maxWidth: 640 }}>
        <Steps at={3} />
        <h1>Connect your wallet</h1>
        <p className="muted">Step 3 of 3 — optional, and on your own volition. You can just watch in paper mode.</p>
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
