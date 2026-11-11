/**
 * Supported wallets, Wallet Standard / injected names, and mobile deep links.
 * Connecting is always optional and on the user's own volition.
 */
export const WALLET_CONNECT_COPY = {
  headline: 'You stay in control',
  body: 'Cletus never stores or sees your private keys or recovery phrase. Connecting a wallet is optional and on your own volition. A short Sign-In-With-Solana message proves it is your wallet — it is not a transaction and grants no spending permission. When you trade for real, Cletus prepares a Jupiter swap and you approve each one in your wallet. You can disconnect at any time.',
  paper: 'Just watch in paper mode — no wallet needed. Cletus paper-trades with simulated fills on live market data. You can connect a wallet later.',
  disconnect: 'Disconnect anytime. Cletus will keep your paper account; he cannot move funds without you.',
};

export interface SupportedWallet {
  id: 'phantom' | 'solflare' | 'backpack';
  name: string;
  adapterName: string;
  color: string;
  download: string;
  /** Open the current page inside the wallet's in-app browser (mobile). */
  browseDeepLink: (pageUrl: string) => string;
}

function originOf(pageUrl: string): string {
  try { return new URL(pageUrl).origin; } catch { return ''; }
}

export const SUPPORTED_WALLETS: SupportedWallet[] = [
  {
    id: 'phantom',
    name: 'Phantom',
    adapterName: 'Phantom',
    color: '#AB9FF2',
    download: 'https://phantom.app/download',
    browseDeepLink: (url) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(originOf(url))}`,
  },
  {
    id: 'solflare',
    name: 'Solflare',
    adapterName: 'Solflare',
    color: '#FCAD27',
    download: 'https://solflare.com/download',
    browseDeepLink: (url) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}`,
  },
  {
    id: 'backpack',
    name: 'Backpack',
    adapterName: 'Backpack',
    color: '#E33E3F',
    download: 'https://backpack.app/download',
    browseDeepLink: (url) => `https://backpack.app/ul/browse?url=${encodeURIComponent(url)}`,
  },
];

export function isMobileUserAgent(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

/** True when a page is already open inside a known in-app wallet browser. */
export function inWalletBrowser(ua: string): boolean {
  return /Phantom|Solflare|Backpack/i.test(ua);
}
