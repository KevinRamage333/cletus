'use client';
import { useMemo, useEffect } from 'react';
import type { ComponentType, PropsWithChildren } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import { Buffer } from 'buffer';

const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

// The wallet-adapter package's published React component types can resolve
// against a different ReactNode declaration than this Next.js app. Keep the
// runtime providers unchanged while adapting their public JSX surface to the
// app's installed React 18 types.
const CompatibleConnectionProvider = ConnectionProvider as unknown as ComponentType<
  PropsWithChildren<{ endpoint: string }>
>;
const CompatibleWalletProvider = WalletProvider as unknown as ComponentType<
  PropsWithChildren<{
    wallets: ReturnType<typeof createWalletAdapters>;
    autoConnect?: boolean;
    localStorageKey?: string;
  }>
>;

function createWalletAdapters() {
  return [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new BackpackWalletAdapter(),
  ];
}

/**
 * Legacy adapters are fallbacks for wallets that are not (yet) Wallet Standard.
 * WalletProvider already:
 *   - auto-detects Wallet Standard wallets (including Jupiter when installed)
 *   - supports Solana Mobile Wallet Adapter on Android mobile web
 * Do not register a legacy adapter named "Jupiter": that would shadow the
 * Standard wallet of the same name.
 */
export default function WalletProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window !== 'undefined' && !(window as unknown as { Buffer?: typeof Buffer }).Buffer) {
      (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
    }
  }, []);
  const wallets = useMemo(() => createWalletAdapters(), []);
  return (
    <CompatibleConnectionProvider endpoint={endpoint}>
      <CompatibleWalletProvider wallets={wallets} autoConnect={false} localStorageKey="cletus.wallet.adapter">
        {children}
      </CompatibleWalletProvider>
    </CompatibleConnectionProvider>
  );
}
