import Link from 'next/link';
import { PageHeader, StateBox } from '@/components/app/ui';
import SolanaWalletCard from '@/components/wallet/SolanaWalletCard';
import EvmWalletCard from '@/components/wallet/EvmWalletCard';
import { isDemo } from '@/lib/demo';
import { walletConnectEnabled, WALLET_CONNECT_OFF_MESSAGE } from '@/lib/wallet-flag';
export const dynamic = 'force-dynamic';

export default function WalletPage() {
  const demo = isDemo();
  return (
    <div>
      <PageHeader eyebrow="Wallets" title={walletConnectEnabled() ? 'Connect your wallets' : 'Wallets'}>
        Connect only. Cletus reads your public address and native balance. It never asks for a private key or seed phrase and never sends a transaction from this screen. The optional ownership proof is an off-chain message checked in your browser.
      </PageHeader>
      <div className="mb-5"><StateBox kind="info" title="Live trading is disabled">Connecting a wallet does not enable trading. All Cletus trading on this platform is simulated.</StateBox></div>
      {walletConnectEnabled() ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <SolanaWalletCard />
          <EvmWalletCard />
        </div>
      ) : (
        <div data-testid="wallet-connect-disabled"><StateBox kind="empty" title="Wallet connect is off">{WALLET_CONNECT_OFF_MESSAGE}</StateBox></div>
      )}
      {!demo && <p className="mt-6 text-xs text-[#8a8478]">Members: account wallet settings, the engine wallet and withdrawal tools are on the <Link href="/app/wallet/engine" className="text-[#c9a24a] underline">engine wallet page</Link>.</p>}
    </div>
  );
}
