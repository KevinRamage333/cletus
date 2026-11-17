/**
 * EVM wallet configuration (wagmi + viem): connect-only. Cletus never sends EVM transactions; the only
 * signature it requests is an optional, off-chain ownership message verified in the browser.
 */
import { createConfig, fallback, http, injected } from 'wagmi';
import { base, bsc, cronos, mainnet, polygon } from 'wagmi/chains';
// Injected-only connectors (no WalletConnect relay, no vendor SDK bundles). EIP-6963 discovery adds any other installed wallet.

export const EVM_CHAINS = [mainnet, base, bsc, polygon, cronos] as const;
export const EVM_CHAIN_META: Record<number, { id: string; name: string; explorer: string }> = {
  [mainnet.id]: { id: 'ethereum', name: 'Ethereum', explorer: 'https://etherscan.io/address/' },
  [base.id]: { id: 'base', name: 'Base', explorer: 'https://basescan.org/address/' },
  [bsc.id]: { id: 'bnb', name: 'BNB Chain', explorer: 'https://bscscan.com/address/' },
  [polygon.id]: { id: 'polygon', name: 'Polygon', explorer: 'https://polygonscan.com/address/' },
  [cronos.id]: { id: 'cronos', name: 'Cronos', explorer: 'https://cronoscan.com/address/' },
};

/** Free public RPCs first, then each chain's default. Overridable per chain with NEXT_PUBLIC_RPC_<CHAINID>. */
const PUBLIC_RPC: Record<number, string> = {
  [mainnet.id]: 'https://ethereum-rpc.publicnode.com',
  [base.id]: 'https://base-rpc.publicnode.com',
  [bsc.id]: 'https://bsc-rpc.publicnode.com',
  [polygon.id]: 'https://polygon-bor-rpc.publicnode.com',
  [cronos.id]: 'https://cronos-evm-rpc.publicnode.com',
};
const rpc = (id: number) => fallback([http(process.env[`NEXT_PUBLIC_RPC_${id}`] || PUBLIC_RPC[id]), http()]);

export function createEvmConfig() {
  return createConfig({
    chains: EVM_CHAINS,
    connectors: [
      injected({ target: 'metaMask' }),
      injected({ target: 'coinbaseWallet' }),
      injected(),
    ],
    multiInjectedProviderDiscovery: true, // EIP-6963: Rabby, OKX, Trust, Crypto.com DeFi, Brave, etc.
    ssr: true,
    transports: { [mainnet.id]: rpc(mainnet.id), [base.id]: rpc(base.id), [bsc.id]: rpc(bsc.id), [polygon.id]: rpc(polygon.id), [cronos.id]: rpc(cronos.id) },
  });
}

export function ownershipMessage(address: string, chain: string, nonce: string, issuedAt: string) {
  return `Cletus wallet ownership check\n\nAddress: ${address}\nNetwork: ${chain}\nNonce: ${nonce}\nIssued: ${issuedAt}\n\nThis signature proves you control this address. It is not a transaction, costs nothing, and grants no permission to move funds.`;
}

export const EVM_INSTALL_LINKS: Record<string, string> = {
  metaMask: 'https://metamask.io/download/',
  coinbaseWallet: 'https://www.coinbase.com/wallet/downloads',
};
