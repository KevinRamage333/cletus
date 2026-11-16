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

type EvmBalance = {
  key: string;
  name: string;
  symbol: string;
  chainId: string;
  balance: string | null;
  status: 'ok' | 'not_configured' | 'unavailable';
  error?: string;
};

type SolanaToken = {
  mint: string;
  amount: string;
  decimals: number;
  tokenAccounts: number;
  program: string;
};

type SolanaPortfolio = {
  address: string | null;
  solBalance: number | null;
  usdcBalance: number | null;
  balancesKnown: boolean;
  balanceError?: string | null;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const NETWORKS = [
  { id: '0x1', name: 'Ethereum', symbol: 'ETH' },
  { id: '0x2105', name: 'Base', symbol: 'ETH' },
  { id: '0xa4b1', name: 'Arbitrum One', symbol: 'ETH' },
  { id: '0x89', name: 'Polygon PoS', symbol: 'POL' },
  { id: '0xa', name: 'Optimism', symbol: 'ETH' },
  { id: '0x1237', name: 'Robinhood Chain', symbol: 'ETH' },
  { id: '0xa86a', name: 'Avalanche C-Chain', symbol: 'AVAX' },
  { id: '0x38', name: 'BNB Smart Chain', symbol: 'BNB' },
  { id: '0x8f', name: 'Monad', symbol: 'MON' },
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
  const [balances, setBalances] = useState<EvmBalance[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [solanaPortfolio, setSolanaPortfolio] = useState<SolanaPortfolio | null>(null);
  const [solanaTokens, setSolanaTokens] = useState<SolanaToken[]>([]);
  const [solanaTokensLoading, setSolanaTokensLoading] = useState(false);
  const [solanaTokensError, setSolanaTokensError] = useState<string | null>(null);
  const [solanaLoading, setSolanaLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSolanaPortfolio() {
      setSolanaLoading(true);
      try {
        const response = await fetch('/api/protected/wallet/status', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error('Could not load the linked Solana wallet.');
        const payload = await response.json();
        if (!cancelled) setSolanaPortfolio({
          address: payload.address ?? null,
          solBalance: payload.balancesKnown ? Number(payload.solBalance) : null,
          usdcBalance: payload.balancesKnown ? Number(payload.usdcBalance) : null,
          balancesKnown: Boolean(payload.balancesKnown),
          balanceError: payload.balanceError ?? null,
        });
      } catch {
        if (!cancelled) setSolanaPortfolio(null);
      } finally {
        if (!cancelled) setSolanaLoading(false);
      }
    }
    loadSolanaPortfolio();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSolanaTokens() {
      if (!solanaPortfolio?.address) {
        setSolanaTokens([]);
        return;
      }
      setSolanaTokensLoading(true);
      setSolanaTokensError(null);
      try {
        const response = await fetch('/api/protected/wallet/solana-tokens', {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not load Solana token holdings.');
        if (!cancelled) setSolanaTokens(Array.isArray(payload.tokens) ? payload.tokens : []);
      } catch (e) {
        if (!cancelled) setSolanaTokensError((e as Error).message || 'Could not load Solana token holdings.');
      } finally {
        if (!cancelled) setSolanaTokensLoading(false);
      }
    }
    loadSolanaTokens();
    return () => { cancelled = true; };
  }, [solanaPortfolio?.address]);

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

  async function refreshBalances(walletAddress: string) {
    setBalancesLoading(true);
    try {
      const response = await fetch(`/api/protected/wallet/evm-balances?address=${encodeURIComponent(walletAddress)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load EVM balances.');
      setBalances(payload.balances || []);
      setCheckedAt(payload.checkedAt || new Date().toISOString());
    } catch (e) {
      setError((e as Error).message || 'Could not load EVM balances.');
    } finally {
      setBalancesLoading(false);
    }
  }

  async function connect() {
    if (!active?.provider) return;
    setBusy(true); setError(null);
    try {
      const accounts = await active.provider.request({ method: 'eth_requestAccounts' }) as string[];
      const chain = await active.provider.request({ method: 'eth_chainId' }) as string;
      if (!accounts?.[0]) throw new Error('The wallet did not return an account.');
      setAddress(accounts[0]);
      setChainId(chain);
      await refreshBalances(accounts[0]);
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
      const message = (e as Error).message || 'Network switch was not completed.';
      setError(message.includes('4902') || message.toLowerCase().includes('unrecognized chain')
        ? 'This network is not configured in your wallet yet. Add it in your wallet, then try again.'
        : message);
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    setAddress(null);
    setChainId(null);
    setBalances([]);
    setCheckedAt(null);
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4" aria-label="Multi-chain EVM wallet connections">
      <div>
        <h2 className="text-lg font-semibold">Multi-chain wallets</h2>
        <p className="text-sm text-white/55 mt-1">Connect an EVM wallet once, then view its native-coin balances across the nine supported EVM networks. Read-only only: no signing, swaps, or transfers.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <select
          aria-label="Choose EVM wallet"
          value={selected}
          onChange={(event) => { setSelected(event.target.value); setAddress(null); setChainId(null); setBalances([]); setCheckedAt(null); }}
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

      {(address || solanaPortfolio?.address || solanaLoading) && <div className="rounded-xl border border-white/10 bg-black/25 p-4 space-y-4" data-testid="unified-portfolio">
        <div>
          <h3 className="text-sm font-semibold">Portfolio overview</h3>
          <p className="text-xs text-white/40">Read-only native balances across your linked Solana wallet and connected EVM wallet. Quantities only; no combined USD value is claimed.</p>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/45">Solana</div>
          {solanaLoading ? <p className="text-xs text-white/45">Loading linked Solana wallet…</p> : solanaPortfolio?.address ? <>
            <code className="block break-all text-[11px] text-white/35">{solanaPortfolio.address}</code>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="text-xs text-white/50">SOL</div>
                <div className="mt-1 font-mono text-sm">{solanaPortfolio.balancesKnown && solanaPortfolio.solBalance !== null ? `${solanaPortfolio.solBalance.toFixed(6)} SOL` : 'Unavailable'}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="text-xs text-white/50">USDC</div>
                <div className="mt-1 font-mono text-sm">{solanaPortfolio.balancesKnown && solanaPortfolio.usdcBalance !== null ? `${solanaPortfolio.usdcBalance.toFixed(2)} USDC` : 'Unavailable'}</div>
              </div>
            </div>
            {!solanaPortfolio.balancesKnown && <p className="text-[11px] text-amber-200/70">Solana balance data is not currently available{solanaPortfolio.balanceError ? `: ${solanaPortfolio.balanceError}` : '.'}</p>}
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-white/45">SPL token holdings</div>
                <span className="text-[10px] text-white/35">{solanaTokens.length} assets</span>
              </div>
              {solanaTokensLoading
                ? <p className="text-xs text-white/45">Reading SPL and Token-2022 balances…</p>
                : solanaTokensError
                  ? <p className="text-xs text-amber-200/70">{solanaTokensError}</p>
                  : solanaTokens.length === 0
                    ? <p className="text-xs text-white/45">No non-zero SPL token balances found.</p>
                    : <div className="max-h-72 overflow-y-auto divide-y divide-white/5">
                      {solanaTokens.map((token) => (
                        <div key={token.mint} className="py-2 flex items-center gap-2 text-xs">
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-white/80">{token.mint.slice(0, 6)}…{token.mint.slice(-6)}</div>
                            <div className="text-[10px] text-white/35">{token.program} · {token.tokenAccounts} account{token.tokenAccounts === 1 ? '' : 's'}</div>
                          </div>
                          <div className="font-mono text-right text-white/75 break-all">{Number(token.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}</div>
                        </div>
                      ))}
                    </div>}
              <p className="text-[10px] text-white/30">Token names and dollar values are not shown until verified metadata and pricing are available.</p>
            </div>
          </> : <p className="text-xs text-white/45">No Solana wallet is linked to this Cletus account.</p>}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-white/45">EVM networks</div>
            <button type="button" disabled={!address || balancesLoading} onClick={() => address && refreshBalances(address)} className="rounded-lg border border-white/15 px-3 py-2 text-xs disabled:opacity-40">
              {balancesLoading ? 'Refreshing…' : 'Refresh EVM'}
            </button>
          </div>
          {address ? <>
            <code className="block break-all text-[11px] text-white/35">{address}</code>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {balances.map((item) => (
                <div key={item.key} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-xs text-white/50">{item.name}</div>
                  {item.status === 'ok'
                    ? <div className="mt-1 font-mono text-sm">{item.balance} <span className="text-xs text-white/40">{item.symbol}</span></div>
                    : <div className="mt-1 text-xs text-amber-200/70">{item.status === 'not_configured' ? 'RPC not configured' : 'Temporarily unavailable'}</div>}
                  {item.status === 'unavailable' && item.error && <div className="mt-1 text-[10px] text-white/30 break-words">{item.error}</div>}
                </div>
              ))}
              {balances.length === 0 && <p className="col-span-full text-xs text-white/45">{balancesLoading ? 'Reading EVM balances…' : 'No EVM balances loaded yet.'}</p>}
            </div>
          </> : <p className="text-xs text-white/45">Connect an EVM wallet above to include its nine supported networks.</p>}
        </div>
        <p className="text-[11px] text-white/35">This first portfolio view includes Solana SOL/USDC and EVM native coins only. SPL/ERC-20 tokens, NFTs, market prices, and USD valuation are not included yet. Wallets remain separate and self-custodied; Cletus does not sign or move funds.</p>
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
      <p className="text-[11px] text-white/35">Wallet detection uses standard browser provider announcements where available. Network switching is always initiated by you. Cletus only reads public balances; it never receives keys or signs transactions. Some wallets require you to add a network before switching. Wallet linking to your Cletus account and Solana/EVM identity verification remain separate steps.</p>
    </section>
  );
}
