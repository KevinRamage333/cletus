'use client';
import { useEffect, useState } from 'react';

type Provider = {
  isOkxWallet?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};
type Announcement = { detail?: { info?: { rdns?: string; name?: string }; provider?: Provider } };
const ADDRESS_KEY = 'cletus_okx_address';
function validAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}
export default function OkxWalletConnect() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const injected = window as typeof window & { okxwallet?: Provider; ethereum?: Provider };
    const detect = (event: Event) => {
      const detail = (event as CustomEvent<Announcement['detail']>).detail;
      if (detail?.provider && (detail.info?.rdns === 'com.okex.wallet' || detail.info?.rdns === 'com.okx.wallet' || detail.provider.isOkxWallet)) setProvider(detail.provider);
    };
    window.addEventListener('eip6963:announceProvider', detect);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    if (injected.okxwallet?.request) setProvider(injected.okxwallet);
    else if (injected.ethereum?.isOkxWallet) setProvider(injected.ethereum);
    return () => window.removeEventListener('eip6963:announceProvider', detect);
  }, []);
  useEffect(() => {
    if (!provider) { setAddress(null); return; }
    let active = true;
    const refresh = async () => {
      try {
        const accounts = await provider.request({ method: 'eth_accounts' });
        const first = Array.isArray(accounts) ? accounts[0] : null;
        if (active) setAddress(validAddress(first) ? first : null);
      } catch { if (active) setAddress(null); }
    };
    const changed = (accounts: unknown) => {
      const first = Array.isArray(accounts) ? accounts[0] : null;
      setAddress(validAddress(first) ? first : null);
    };
    const disconnected = () => setAddress(null);
    void refresh();
    provider.on?.('accountsChanged', changed);
    provider.on?.('disconnect', disconnected);
    return () => {
      active = false;
      provider.removeListener?.('accountsChanged', changed);
      provider.removeListener?.('disconnect', disconnected);
    };
  }, [provider]);
  useEffect(() => {
    if (address) sessionStorage.setItem(ADDRESS_KEY, address);
    else sessionStorage.removeItem(ADDRESS_KEY);
  }, [address]);
  const connect = async () => {
    if (!provider) { setError('Open Cletus in the OKX Wallet browser or install OKX Wallet.'); return; }
    setBusy(true); setError('');
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const first = Array.isArray(accounts) ? accounts[0] : null;
      if (!validAddress(first)) throw new Error('OKX did not return a valid EVM address');
      setAddress(first);
    } catch (e) { setError(e instanceof Error ? e.message : 'Connection rejected'); }
    finally { setBusy(false); }
  };
  return <div className="card p-4 space-y-2" data-testid="okx-wallet-connect">
    <div className="flex items-center gap-2 flex-wrap">
      <b>OKX Wallet</b>
      {address && <span className="text-xs font-mono text-white/60">{address.slice(0,6)}…{address.slice(-4)}</span>}
      <span className="ml-auto" />
      {address
        ? <button type="button" className="btn small" onClick={() => setAddress(null)}>Hide address</button>
        : <button type="button" className="btn small" disabled={busy} onClick={connect}>{busy ? 'Connecting…' : 'Connect OKX'}</button>}
    </div>
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    <p className="text-[11px] text-white/45">Read-only EVM address connection. No seed phrase, signing, or trading permission requested. Hiding the address does not disconnect the wallet extension.</p>
  </div>;
}
