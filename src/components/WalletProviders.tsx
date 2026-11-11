'use client';
import { useMemo, useEffect } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import { Buffer } from 'buffer';

const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

/**
 * Legacy adapters are fallbacks for wallets that are not (yet) Wallet Standard.
 * WalletProvider already:
 *   - auto-detects Wallet Standard wallets (Jupiter registers as "Jupiter")
 *   - prepends Solana Mobile Wallet Adapter on Android mobile web
 * Do not register a legacy adapter named "Jupiter": that would shadow the
 * Standard wallet of the same name.
 */
export default function WalletProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window !== 'undefined' && !(window as unknown as { Buffer?: typeof Buffer }).Buffer) {
      (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
    }
  }, []);
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new BackpackWalletAdapter(),
  ], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false} localStorageKey="cletus.wallet.adapter">
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
