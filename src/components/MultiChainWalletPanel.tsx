'use client';

import { useEffect, useMemo, useState } from 'react';

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isOkxWallet?: boolean;
  isCryptoComWallet?: boolean;
  providers?: Eip1193Provider[];
};

type ProviderDetail = {
  info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
  provider: Eip1193Provider;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const NETWORKS = [
  { id: '0x1', name: 'Ethereum', symbol: 'ETH' },
  { id: '0x2105', name: 'Base', symbol: 'ETH' },
  { id: '0x38', name: 'BNB Chain', symbol: 'BNB' },
  { id: '0x89', name: 'Polygon', symbol: 'POL' },
  { id: '0x19', name: 'Cronos', symbol: 'CRO' },
] as const;

function providerLabel(detail: ProviderDetail): string {
  const rdns = detail.info?.rdns?.toLowerCase() ?? '';
  const name = detail.info?.name?.toLowerCase() ?? '';
  if (rdns.includes('metamask') || detail.provider.isMetaMask) return 'MetaMask';
  if (rdns.includes('okx') || name.includes('okx') || detail.provider.isOkxWallet) return 'OKX Wallet';
  if (rdns.includes('crypto') || name.includes('crypto.com') || detail.provider.isCryptoComWallet) return 'Crypto.com Onchain';
  if (rdns.includes('coinbase') || name.includes('coinbase') || detail.provider.isCoinbaseWallet) return 'Base App / Coinbase Wallet';
  return detail.info?.name || 'EVM wallet';
}

export default function MultiChainWalletPanel() {
  const [providers, setProviders] = useState<ProviderDetail[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const found = new Map<string, ProviderDetail>();
    const add = (detail: ProviderDetail) => {
      const key = detail.info?.uuid || detail.info?.rdns || String(providers.length);
      found.set(key, detail);
      setProviders(Array.from(found.entries()).map(([id, value]) => ({ ...value, info: { ...value.info, uuid: id } })));
    };
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<ProviderDetail>).detail;
      if (detail?.provider) add(detail);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const injected = window.ethereum;
    if (injected) {
      const list = injected.providers?.length ? injected.providers : [injected];
      list.forEach((provider, index) => add({ info: { uuid: 'injected-' + index, name: providerLabel({ provider }) }, provider }));
    }
    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
    // Provider discovery is a one-time browser capability check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = useMemo(() => providers.find((p) => (p.info?.uuid || p.info?.rdns) === selected), [providers, selected]);
  const activeNetwork = NETWORKS.find((network) => network.id === chainId)?.name ?? (chainId ? 'Unsupported network' : 'Not connected');

  async function connect() {
    if (!active?.provider) return;
    setBusy(true); setError(null);
    try {
      const accounts = await active.provider.request({ method: 'eth_requestAccounts' }) as string[];
      const chain = await active.provider.request({ method: 'eth_chainId' }) as string;
      if (!accounts?.[0]) throw new Error('The wallet did not return an account.');
      setAddress(accounts[0]);
      setChainId(chain);
    } catch (e) {
      setError((e as Error).message || 'Wallet connection was cancelled.');
    } finally {
      setBusy(false);
    }
  }

  async function switchNetwork(id: string) {
    if (!active?.provider || !address) return;
    setBusy(true); setError(null);
    try {
      await active.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: id }] });
      const chain = await active.provider.request({ method: 'eth_chainId' }) as string;
      setChainId(chain);
    } catch (e) {
      setError((e as Error).message || 'Network switch was not completed.');
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    // EIP-1193 has no universal disconnect method. Clear only Cletus's local view;
    // the wallet's own site permissions remain under the user's control.
    setAddress(null);
    setChainId(null);
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4" aria-label="Multi-chain EVM wallet connections">
      <div>
        <h2 className="text-lg font-semibold">Multi-chain wallets</h2>
        <p className="text-sm text-white/55 mt-1">Connect an EVM wallet once, then switch between supported networks. This is a read-only connection; it does not authorize swaps or transfers.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <select
          aria-label="Choose EVM wallet"
          value={selected}
          onChange={(event) => { setSelected(event.target.value); setAddress(null); setChainId(null); }}
          className="w-full rounded-lg border border-white/15 bg-black px-3 py-3 text-sm text-white"
        >
          <option value="">Choose detected wallet…</option>
          {providers.map((provider, index) => {
            const id = provider.info?.uuid || provider.info?.rdns || String(index);
            return <option key={id} value={id}>{providerLabel(provider)}</option>;
          })}
        </select>
        {address
          ? <button type="button" onClick={disconnect} className="rounded-lg border border-white/20 px-4 py-3 text-sm">Disconnect view</button>
          : <button type="button" onClick={connect} disabled={!active || busy} className="rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-40">{busy ? 'Connecting…' : 'Connect wallet'}</button>}
      </div>

      {providers.length === 0 && <p className="text-xs text-amber-200/80">No browser wallet was detected. Open this page in your wallet's dApp browser or install its browser extension.</p>}
      {address && <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
        <div className="text-xs uppercase tracking-wide text-emerald-300">Connected · {activeNetwork}</div>
        <code className="mt-1 block break-all text-xs text-white/80">{address}</code>
      </div>}

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-white/40 mb-2">EVM networks</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {NETWORKS.map((network) => {
            const current = chainId === network.id;
            return <button key={network.id} type="button" disabled={!address || busy || current} onClick={() => switchNetwork(network.id)} className={`rounded-lg border px-3 py-3 text-left text-sm transition-colors ${current ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-black/30 text-white/65 hover:border-white/30'}`}>
              <span className="block font-semibold">{network.name}</span>
              <span className="text-xs opacity-60">{current ? 'Active network' : network.symbol}</span>
            </button>;
          })}
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <p className="text-[11px] text-white/35">Wallet detection uses the browser's standard provider announcements where available. Network switching is always initiated by you. Wallet linking to your Cletus account and Solana/EVM identity verification are separate steps still being built.</p>
    </section>
  );
}
