'use client';
import { useRouter } from 'next/navigation';
import ConnectWallet from '@/components/ConnectWallet';

function DemoWalletStep() {
  const router = useRouter();
  const goDash = () => { router.push('/demo/dashboard'); };
  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div>
        <p className="text-xs uppercase tracking-wider text-amber-300">Public demo · step 3 of 3 (preview)</p>
        <h1 className="text-3xl font-extrabold gold-text mt-1">Connect your wallet</h1>
        <p className="text-sm text-zinc-400 mt-2">Terms, then Disclaimer + Acknowledge, then Wallet. This is a preview — public sign-up is closed, so a connection here is not saved as an account.</p>
      </div>
      <ConnectWallet mode="demo" onPaper={goDash} onConnected={goDash} />
    </div>
  );
}

export default function DemoWalletPage() {
  return <DemoWalletStep />;
}
