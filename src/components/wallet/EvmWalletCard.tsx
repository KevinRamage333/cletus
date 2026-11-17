'use client';
import { useEffect, useState } from 'react';
import { useAccount, useBalance, useConnect, useDisconnect, useSignMessage, useSwitchChain } from 'wagmi';
import { verifyMessage, formatUnits } from 'viem';
import { Refreshed, StateBox } from '@/components/app/ui';
import { EVM_CHAINS, EVM_CHAIN_META, EVM_INSTALL_LINKS, ownershipMessage, dedupeEvmConnectors } from '@/lib/evm-wallet';

export function ChainBalance({ address, chainId, active }: { address: `0x${string}`; chainId: number; active: boolean }) {
  const { data, isLoading, isError, dataUpdatedAt } = useBalance({ address, chainId, query: { refetchInterval: 60_000 } });
  const meta = EVM_CHAIN_META[chainId];
  const chain = EVM_CHAINS.find((c) => c.id === chainId)!;
  return (
    <li className={`flex items-center justify-between gap-2 border px-3 py-2 text-sm ${active ? 'border-[#d4af37]/60 bg-[#d4af37]/5' : 'border-white/10'}`} data-testid={`evm-balance-${meta.id}`}>
      <span className="font-semibold text-[#f6f1e4]">{meta.name}{active && <span className="ml-2 text-[10px] uppercase tracking-wider text-[#e3c06a]">active</span>}</span>
      <span className="num text-right text-xs">{isLoading ? <span className="text-[#8a8478]">…</span> : isError || !data ? <span className="text-[#8a8478]" title="Public RPC did not respond">unavailable</span> : <span className="text-[#d8d2c5]" title={dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : ''}>{Number(formatUnits(data.value, data.decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })} {chain.nativeCurrency.symbol}</span>}</span>
    </li>
  );
}

export default function EvmWalletCard() {
  const { address, isConnected, connector, chainId } = useAccount();
  const { connectors, connect, isPending, error: connectErr, variables } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchErr } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const [proof, setProof] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hasInjected, setHasInjected] = useState(false);
  const [detected, setDetected] = useState<Record<string, boolean>>({});
  useEffect(() => { setHasInjected(typeof window !== 'undefined' && !!(window as unknown as { ethereum?: unknown }).ethereum); }, []);
  useEffect(() => {
    let live = true;
    void Promise.all(connectors.map(async (c) => [c.uid, !!(await c.getProvider().catch(() => null))] as const)).then((r) => { if (live) setDetected(Object.fromEntries(r)); });
    return () => { live = false; };
  }, [connectors]);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  useEffect(() => { setProof(null); setConnectedAt(address ? Date.now() : null); }, [address, chainId]);
  const supported = EVM_CHAINS.some((c) => c.id === chainId);
  // De-duplicate by EIP-6963 rdns (or connector id), never by display name.
  const list = dedupeEvmConnectors(connectors);

  const prove = async () => {
    if (!address) return;
    setErr(null);
    try {
      const message = ownershipMessage(address, EVM_CHAIN_META[chainId ?? 1]?.name ?? `chain ${chainId}`, crypto.randomUUID(), new Date().toISOString());
      const signature = await signMessageAsync({ message });
      setProof((await verifyMessage({ address, message, signature })) ? 'Browser-only check passed. This is not a server-verified proof and grants no access.' : 'Browser-only check failed.');
    } catch (e) { setErr((e as Error)?.message?.split('\n')[0] || 'Signing was cancelled.'); }
  };

  return (
    <section className="panel panel-hi p-5" data-testid="evm-card">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">EVM · Ethereum, Base, BNB, Polygon, Cronos</h3>{isConnected && connectedAt !== null && <Refreshed at={connectedAt} label="Connected" />}</div>
      {isConnected && address ? (
        <div className="mt-4 space-y-3">
          <div><p className="text-xs text-[#8a8478]">{connector?.name} · {supported ? EVM_CHAIN_META[chainId!].name : `unsupported network (${chainId})`}</p><p className="num break-all text-sm text-[#f6f1e4]" data-testid="evm-address">{address}</p></div>
          {!supported && <StateBox kind="stale" title="Your wallet is on a network Cletus does not support">Switch to one of the networks below.</StateBox>}
          <div><p className="mb-2 text-[11px] uppercase tracking-wider text-[#8a8478]">Switch network</p><div className="flex flex-wrap gap-1.5" data-testid="evm-switch">{EVM_CHAINS.map((c) => <button key={c.id} disabled={switching || c.id === chainId} onClick={() => { setErr(null); switchChain({ chainId: c.id }); }} className={`border px-2.5 py-1 text-xs font-semibold ${c.id === chainId ? 'border-[#d4af37] bg-[#d4af37]/15 text-[#f3dc95]' : 'border-white/10 text-[#a39c8f] hover:text-[#f2ede2]'}`}>{EVM_CHAIN_META[c.id].name}</button>)}</div></div>
          <ul className="space-y-1.5">{EVM_CHAINS.map((c) => <ChainBalance key={c.id} address={address} chainId={c.id} active={c.id === chainId} />)}</ul>
          <div className="flex flex-wrap gap-2">
            <button className="btn-line !py-2" onClick={prove} data-testid="evm-prove">Browser signature check</button>
            {supported && <a className="btn-line !py-2" href={`${EVM_CHAIN_META[chainId!].explorer}${address}`} target="_blank" rel="noreferrer">Explorer ↗</a>}
            <button className="btn-line !py-2" onClick={() => disconnect()} data-testid="evm-disconnect">Disconnect</button>
          </div>
          {proof && <p className={`text-xs ${proof.startsWith('Browser-only check passed') ? 'text-[#d8d2c5]' : 'text-red-300'}`} role="status" data-testid="evm-proof">{proof}</p>}
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {list.map((c) => (
            <div key={c.uid} className="flex items-center justify-between gap-2 border border-white/10 px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 font-semibold text-[#f6f1e4]">{c.icon ? <img src={c.icon} alt="" width={22} height={22} /> : <span className="h-[22px] w-[22px] rounded bg-gradient-to-br from-[#f3dc95] to-[#8f6e22]" />}<span className="min-w-0 truncate">{c.name === 'Injected' ? 'Browser wallet' : c.name}{typeof c.rdns === 'string' && c.rdns ? <span className="ml-2 text-[10px] font-normal text-[#8a8478]">{c.rdns}</span> : null}</span></span>
              {detected[c.uid] === false && EVM_INSTALL_LINKS[c.id]
                ? <a className="btn-line !px-3 !py-1.5" href={EVM_INSTALL_LINKS[c.id]} target="_blank" rel="noreferrer">Install</a>
                : <button className="btn-gold !px-3 !py-1.5" disabled={isPending || detected[c.uid] === false} onClick={() => { setErr(null); connect({ connector: c }); }} data-testid={`evm-connect-${c.id}`}>{isPending && variables?.connector && 'uid' in variables.connector && variables.connector.uid === c.uid ? 'Connecting…' : detected[c.uid] === false ? 'Not detected' : 'Connect'}</button>}
            </div>
          ))}
          {!hasInjected && <p className="text-[11px] text-[#8a8478]">No browser wallet detected. Install MetaMask or Coinbase Wallet, or open this page in your wallet app's built-in browser on mobile.</p>}
        </div>
      )}
      {(err || connectErr || switchErr) && <p className="mt-3 text-xs text-red-300" role="alert">{err || connectErr?.message.split('\n')[0] || switchErr?.message.split('\n')[0]}</p>}
    </section>
  );
}
