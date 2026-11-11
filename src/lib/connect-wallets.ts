/**
 * Supported wallets, Wallet Standard / injected names, and mobile deep links.
 * Connecting is always optional and on the user's own volition.
 *
 * Jupiter Wallet registers via Wallet Standard as "Jupiter". Do not add a
 * legacy Jupiter adapter with the same name — that would shadow the Standard
 * wallet. @solana/wallet-adapter-react already auto-detects Standard wallets
 * and, on Android mobile web, prepends Mobile Wallet Adapter.
 */
export const WALLET_CONNECT_COPY = {
  headline: 'You stay in control',
  body: 'Cletus never stores or sees your private keys or recovery phrase. Connecting a wallet is optional and on your own volition. A short Sign-In-With-Solana message proves it is your wallet — it is not a transaction and grants no spending permission. When you trade for real, Cletus prepares a Jupiter swap and you approve each one in your wallet. You can disconnect at any time.',
  paper: 'Just watch in paper mode — no wallet needed. Cletus paper-trades with simulated fills on live market data. You can connect a wallet later.',
  disconnect: 'Disconnect anytime. Cletus will keep your paper account; he cannot move funds without you.',
};

export type SupportedWalletId = 'jupiter' | 'phantom' | 'solflare' | 'backpack';

export interface SupportedWallet {
  id: SupportedWalletId;
  name: string;
  /** Wallet Standard / adapter names this entry can match. First is preferred. */
  adapterNames: string[];
  color: string;
  download: string;
  /**
   * Open the current page inside the wallet's in-app browser (mobile).
   * Omit when no official browse scheme can be verified.
   */
  browseDeepLink?: (pageUrl: string) => string;
  /** Manual steps shown when a verified deep link is not available. */
  mobileOpenHint?: string;
}

function originOf(pageUrl: string): string {
  try { return new URL(pageUrl).origin; } catch { return ''; }
}

/**
 * Jupiter Mobile's docs describe the in-app dApp browser (globe icon, top
 * right) but do not publish a browse deep-link URI we could verify (the
 * native scheme is only documented as `jupiter://`, with no path). Do not
 * invent a browse URL. Show `mobileOpenHint` and a copy-URL control instead.
 */
export const JUPITER_MOBILE_STEPS = [
  'Copy this page’s URL.',
  'Open the Jupiter Mobile app.',
  'Tap the globe icon in the top right to open the dApp browser.',
  'Paste the URL, open this page, then connect Jupiter and sign the message.',
] as const;

export const SUPPORTED_WALLETS: SupportedWallet[] = [
  {
    id: 'jupiter',
    name: 'Jupiter',
    adapterNames: ['Jupiter', 'Jupiter Wallet'],
    color: '#C7F284',
    download: 'https://jup.ag/wallet',
    mobileOpenHint: JUPITER_MOBILE_STEPS.join(' '),
  },
  {
    id: 'phantom',
    name: 'Phantom',
    adapterNames: ['Phantom'],
    color: '#AB9FF2',
    download: 'https://phantom.app/download',
    browseDeepLink: (url) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(originOf(url))}`,
  },
  {
    id: 'solflare',
    name: 'Solflare',
    adapterNames: ['Solflare'],
    color: '#FCAD27',
    download: 'https://solflare.com/download',
    browseDeepLink: (url) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}`,
  },
  {
    id: 'backpack',
    name: 'Backpack',
    adapterNames: ['Backpack'],
    color: '#E33E3F',
    download: 'https://backpack.app/download',
    browseDeepLink: (url) => `https://backpack.app/ul/browse?url=${encodeURIComponent(url)}`,
  },
];

export function listedAdapterNames(wallets: SupportedWallet[] = SUPPORTED_WALLETS): Set<string> {
  return new Set(wallets.flatMap((w) => w.adapterNames));
}

export function findSupportedAdapter<T extends { adapter: { name: string } }>(
  wallets: readonly T[],
  supported: SupportedWallet,
): T | undefined {
  for (const name of supported.adapterNames) {
    const found = wallets.find((w) => w.adapter.name === name);
    if (found) return found;
  }
  return undefined;
}

/** Standard / MWA wallets that are not already covered by SUPPORTED_WALLETS. */
export function extraDetectedWallets<T extends { adapter: { name: string }; readyState?: string }>(
  wallets: readonly T[],
  unsupportedState = 'Unsupported',
): T[] {
  const listed = listedAdapterNames();
  return wallets.filter((w) => !listed.has(w.adapter.name) && w.readyState !== unsupportedState);
}

export function isMobileUserAgent(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

/** True when a page is already open inside a known in-app wallet browser. */
export function inWalletBrowser(ua: string): boolean {
  return /Phantom|Solflare|Backpack|Jupiter/i.test(ua);
}
