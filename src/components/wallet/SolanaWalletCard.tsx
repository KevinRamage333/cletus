'use client';
import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState, type WalletName } from '@solana/wallet-adapter-base';
import nacl from 'tweetnacl';
import { Refreshed, StateBox } from '@/components/app/ui';
import { SUPPORTED_WALLETS, extraDetectedWallets, findSupportedAdapter, inWalletBrowser, isMobileUserAgent } from '@/lib/connect-wallets';
import { ownershipMessage } from '@/lib/evm-wallet';
import { useSolanaHoldings } from './useSolanaHoldings';

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export default function SolanaWalletCard() {
  const { wallets, wallet, select, connect, disconnect, publicKey, connected, connecting, signMessage } = useWallet();
  const [err, setErr] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const pending = useRef<WalletName | null>(null);
  const { sol, fetchedAt, error: balErr, loading, refresh } = useSolanaHoldings(publicKey);
  useEffect(() => { setMobile(isMobileUserAgent(navigator.userAgent) && !inWalletBrowser(navigator.userAgent)); }, []);
  useEffect(() => {
    if (wallet && pending.current === wallet.adapter.name && !connected && !connecting) {
      pending.current = null;
      connect().catch((e: Error) => setErr(e?.message || 'Connection was cancelled.'));
    }
  }, [wallet, connected, connecting, connect]);
  useEffect(() => { setProof(null); }, [publicKey]);

  const pick = (name: WalletName) => { setErr(null); pending.current = name; if (wallet?.adapter.name === name) { connect().catch((e: Error) => setErr(e?.message || 'Connection was cancelled.')); pending.current = null; } else select(name); };
  const prove = async () => {
    if (!publicKey || !signMessage) { setErr('This wallet does not support message signing.'); return; }
    try {
      const msg = new TextEncoder().encode(ownershipMessage(publicKey.toBase58(), 'Solana', crypto.randomUUID(), new Date().toISOString()));
      const sig = await signMessage(msg);
      setProof(nacl.sign.detached.verify(msg, sig, publicKey.toBytes()) ? 'Browser-only check passed. This is not a server-verified proof and grants no access.' : 'Browser-only check failed.');
    } catch (e) { setErr((e as Error)?.message || 'Signing was cancelled.'); }
  };
  const extras = extraDetectedWallets(wallets, WalletReadyState.Unsupported);

  return (
    <section className="panel panel-hi p-5" data-testid="solana-card">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Solana</h3>{connected && <Refreshed at={fetchedAt} stale={!!balErr} label="Balance" />}</div>
      {connected && publicKey ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3">{wallet?.adapter.icon && <img src={wallet.adapter.icon} alt="" width={28} height={28} />}<div className="min-w-0"><p className="text-xs text-[#8a8478]">{wallet?.adapter.name} · connected</p><p className="num break-all text-sm text-[#f6f1e4]" data-testid="sol-address" title={publicKey.toBase58()}>{publicKey.toBase58()}</p></div></div>
          <div className="num text-2xl font-bold text-[#f6f1e4]" data-testid="sol-balance">{sol == null ? (loading ? '…' : '—') : `${sol.toLocaleString('en-US', { maximumFractionDigits: 6 })} SOL`}</div>
          {balErr && <StateBox kind="stale" title="Balance could not refresh">{balErr}</StateBox>}
          <div className="flex flex-wrap gap-2">
            <button className="btn-line !py-2" onClick={() => void refresh()}>Refresh</button>
            <button className="btn-line !py-2" onClick={prove} data-testid="sol-prove">Browser signature check</button>
            <a className="btn-line !py-2" href={`https://solscan.io/account/${publicKey.toBase58()}`} target="_blank" rel="noreferrer">Solscan ↗</a>
            <button className="btn-line !py-2" onClick={() => disconnect().catch(() => undefined)} data-testid="sol-disconnect">Disconnect</button>
          </div>
          {proof && <p className={`text-xs ${proof.startsWith('Browser-only check passed') ? 'text-[#d8d2c5]' : 'text-red-300'}`} role="status">{proof}</p>}
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {SUPPORTED_WALLETS.map((s) => {
            const w = findSupportedAdapter(wallets, s);
            const ready = w && (w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
            return (
              <div key={s.id} className="flex items-center justify-between gap-2 border border-white/10 px-3 py-2.5">
                <span className="flex items-center gap-2 font-semibold text-[#f6f1e4]">{w?.adapter.icon ? <img src={w.adapter.icon} alt="" width={22} height={22} /> : <span className="h-[22px] w-[22px] rounded" style={{ background: s.color }} />}{s.name}</span>
                {ready ? <button className="btn-gold !px-3 !py-1.5" disabled={connecting} onClick={() => pick(w!.adapter.name)} data-testid={`connect-${s.id}`}>{connecting && wallet?.adapter.name === w!.adapter.name ? 'Connecting…' : 'Connect'}</button>
                  : mobile && s.browseDeepLink ? <a className="btn-line !px-3 !py-1.5" href={s.browseDeepLink(window.location.href)}>Open in app</a>
                  : <a className="btn-line !px-3 !py-1.5" href={s.download} target="_blank" rel="noreferrer">Install</a>}
              </div>
            );
          })}
          {extras.map((w) => <div key={w.adapter.name} className="flex items-center justify-between gap-2 border border-white/10 px-3 py-2.5"><span className="flex items-center gap-2 font-semibold text-[#f6f1e4]"><img src={w.adapter.icon} alt="" width={22} height={22} />{w.adapter.name}</span><button className="btn-gold !px-3 !py-1.5" onClick={() => pick(w.adapter.name)}>Connect</button></div>)}
          {mobile && <p className="text-[11px] text-[#8a8478]">On mobile, open this page inside your wallet app&apos;s browser to connect.</p>}
        </div>
      )}
      {err && <p className="mt-3 text-xs text-red-300" role="alert">{err}</p>}
    </section>
  );
}
