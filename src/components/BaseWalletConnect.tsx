'use client';
/**
 * Base app (Coinbase) wallet connection — available to every visitor.
 * Read-only: we only request the address (eth_requestAccounts) and read the
 * Base ETH balance from the public RPC. Nothing is ever signed or sent.
 */
import { useCallback, useEffect, useState } from 'react';
import OkxWalletConnect from './OkxWalletConnect';

export const BASE_REFERRAL = '4T65YD5F';
const KEY = 'cletus_base_addr';
const EVENT = 'cletus-base-addr';
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

export function useBaseAddress(): [string | null, (a: string | null) => void] {
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setAddr(localStorage.getItem(KEY));
    read();
    window.addEventListener(EVENT, read); window.addEventListener('storage', read);
    return () => { window.removeEventListener(EVENT, read); window.removeEventListener('storage', read); };
  }, []);
  const set = useCallback((a: string | null) => {
    if (a) localStorage.setItem(KEY, a); else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [addr, set];
}

async function baseProvider(): Promise<Eip1193> {
  const { createCoinbaseWalletSDK } = await import('@coinbase/wallet-sdk');
  const sdk = createCoinbaseWalletSDK({ appName: 'Cletus', appLogoUrl: `${location.origin}/cletus-logo.png`, appChainIds: [8453], preference: { options: 'all' } });
  return sdk.getProvider() as unknown as Eip1193;
}

export default function BaseWalletConnect({ compact = false }: { compact?: boolean }) {
  const [addr, setAddr] = useBaseAddress();
  const [eth, setEth] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!addr) { setEth(null); return; }
    fetch('https://mainnet.base.org', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [addr, 'latest'] }) })
      .then((r) => r.json()).then((j) => setEth(j?.result ? Number(BigInt(j.result)) / 1e18 : null)).catch(() => setEth(null));
  }, [addr]);

  const connect = async () => {
    setErr(null); setBusy(true);
    try {
      const p = await baseProvider();
      const accts = (await p.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accts?.[0]) throw new Error('No account returned');
      setAddr(accts[0]);
    } catch (e) { setErr((e as Error).message || 'Connection cancelled'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
    <div className={compact ? '' : 'card p-4 space-y-2'}>
      <div className="flex items-center gap-2">
        <span className="inline-block w-5 h-5 rounded-full bg-[#0052FF]" aria-hidden />
        <b>Base app wallet</b>
        {addr && <span className="text-xs font-mono text-white/60">{addr.slice(0, 6)}…{addr.slice(-4)}</span>}
        {addr && eth != null && <span className="text-xs text-white/50">{eth.toFixed(5)} ETH on Base</span>}
        <span className="ml-auto" />
        {addr
          ? <button type="button" className="btn small" onClick={() => setAddr(null)}>Disconnect</button>
          : <button type="button" className="btn small" disabled={busy} onClick={connect}>{busy ? 'Connecting…' : 'Connect Base app'}</button>}
      </div>
      {err && <div className="text-xs text-red-400">{err}</div>}
      <div className="text-[11px] text-white/45">Read-only connection: Cletus sees your address only and never asks to sign or move funds. New to the Base app? Referral code <span className="font-mono text-white/70">{BASE_REFERRAL}</span>.</div>
    </div>
    <OkxWalletConnect />
    </div>
  );
}
