'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount, useSignMessage } from 'wagmi';
import bs58 from 'bs58';
import { PageHeader, StateBox } from '@/components/app/ui';
import { walletConnectEnabled } from '@/lib/wallet-flag';
import SolanaWalletCard from '@/components/wallet/SolanaWalletCard';
import EvmWalletCard from '@/components/wallet/EvmWalletCard';
import { VerifiedBadge } from '@/components/listings/Listings';
import { LISTING_NETWORKS, VERIFIED_DISCLAIMER, VERIFIED_TTL_DAYS, networkMeta, normalizeAddress, type CheckState, type ListingNetwork, type VerifyCheck } from '@/lib/verified';

type Result = { record: { status: 'verified' | 'not_verified'; reasons: string[]; checks: VerifyCheck[]; role: string | null; expiresAt: string | null; name: string | null; symbol: string | null; token: string; network: ListingNetwork }; signatureValid: boolean; controllers: Array<{ role: string; address: string }>; errors: string[]; sources: string[] };
type Listed = { network: ListingNetwork; token: string; name: string | null; symbol: string | null; expiresAt: string | null; checkedAt?: string | null };
const STATE: Record<CheckState, string> = { pass: 'text-green-300 border-green-400/40', warn: 'text-[#f3dc95] border-[#e3c06a]/50', fail: 'text-red-300 border-red-400/50', unknown: 'text-sky-200 border-sky-300/40' };
const LABEL: Record<CheckState, string> = { pass: 'Pass', warn: 'Caution', fail: 'Fail', unknown: 'Unverified' };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function VerifiedPage() {
  if (!walletConnectEnabled()) {
    return (
      <div className="space-y-5" data-testid="verified-off">
        <PageHeader eyebrow="Developers" title="Cletus Verified" />
        <StateBox kind="empty" title="Cletus Verified opens with public wallet connect">Developers will verify token ownership by signing with their wallet. Wallet connect is off for now, so verification is not open yet.</StateBox>
      </div>
    );
  }
  return <VerifiedForm />;
}

function VerifiedForm() {
  const [network, setNetwork] = useState<ListingNetwork>('solana');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [listed, setListed] = useState<Listed[] | null>(null);
  const sol = useWallet();
  const evm = useAccount();
  const { signMessageAsync } = useSignMessage();
  const meta = networkMeta(network)!;
  const wallet = meta.kind === 'solana' ? sol.publicKey?.toBase58() ?? null : evm.address ?? null;
  const tokenOk = !!normalizeAddress(network, token);

  useEffect(() => { fetch('/api/verified', { cache: 'no-store' }).then((r) => r.json()).then((j) => setListed(j.verified ?? [])).catch(() => setListed([])); }, [result]);

  const verify = async () => {
    setErr(null); setResult(null);
    if (!tokenOk) { setErr(`Enter a valid ${meta.name} token address.`); return; }
    if (!wallet) { setErr('Connect the deployer or authority wallet first.'); return; }
    try {
      setBusy('Requesting challenge…');
      const c = await fetch('/api/verified/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ network, token: token.trim(), wallet }) });
      const cj = await c.json(); if (!c.ok) throw new Error(cj.error || 'Challenge failed');
      setBusy('Sign the message in your wallet…');
      let signature: string;
      if (meta.kind === 'solana') {
        if (!sol.signMessage) throw new Error('This wallet does not support message signing.');
        signature = bs58.encode(await sol.signMessage(new TextEncoder().encode(cj.message)));
      } else signature = await signMessageAsync({ message: cj.message });
      setBusy('Running the Cletus audit…');
      const s = await fetch('/api/verified/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ network, token: token.trim(), wallet, challenge: cj.challenge, message: cj.message, signature }), signal: AbortSignal.timeout(45_000) });
      const sj = await s.json(); if (!s.ok) throw new Error(sj.error || `Verification failed (HTTP ${s.status})`);
      setResult(sj);
    } catch (e) { setErr((e as Error)?.message?.split('\n')[0] || 'Verification was cancelled.'); }
    finally { setBusy(null); }
  };

  const r = result?.record;
  return (
    <div>
      <PageHeader eyebrow="For token developers" title={<>Cletus <span className="metal">Verified</span></>}>
        Prove you control your token&apos;s deployer or authority wallet, pass the automated Cletus audit, and your token shows a gold Cletus Verified badge on the Signals board, token pages and Cletus Audit for {VERIFIED_TTL_DAYS} days.
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="panel panel-hi space-y-4 p-5" data-testid="verify-form">
          <h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">1 · Your token</h3>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Network">
            {LISTING_NETWORKS.map((n) => <button key={n.id} type="button" role="radio" aria-checked={network === n.id} onClick={() => { setNetwork(n.id); setResult(null); }} className={`border px-2.5 py-1 text-xs font-semibold ${network === n.id ? 'border-[#d4af37] bg-[#d4af37]/15 text-[#f3dc95]' : 'border-white/10 text-[#a39c8f] hover:text-[#f2ede2]'}`}>{n.name}</button>)}
          </div>
          <input className="field num text-xs" value={token} onChange={(e) => setToken(e.target.value)} placeholder={meta.kind === 'solana' ? 'Solana token mint address' : '0x… token contract address'} aria-label="Token address" data-testid="verify-token" />
          <h3 className="pt-2 text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">2 · Connect the controlling wallet</h3>
          <p className="text-xs text-[#a39c8f]">{meta.kind === 'solana' ? 'Use the metadata update authority, the creator wallet, or the mint/freeze authority.' : 'Use the contract owner or the deployer wallet.'} Cletus only asks for a message signature: no transaction, no fees, no spending permission.</p>
          <div className="text-xs text-[#8a8478]">Connected: <span className="num text-[#f6f1e4]" data-testid="verify-wallet">{wallet ?? 'none'}</span></div>
          <h3 className="pt-2 text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">3 · Sign and audit</h3>
          <button className="btn-gold w-full" disabled={!!busy} onClick={() => void verify()} data-testid="verify-run">{busy ?? 'Sign ownership proof & run audit'}</button>
          {err && <StateBox kind="error" title="Verification could not complete">{err}</StateBox>}
          <p className="text-[11px] text-[#8a8478]">{VERIFIED_DISCLAIMER}</p>
        </section>
        <div>{meta.kind === 'solana' ? <SolanaWalletCard /> : <EvmWalletCard />}</div>
      </div>

      {r && (
        <section className="mt-6 space-y-4" data-testid="verify-result">
          <div className={`panel flex flex-wrap items-center gap-4 border p-5 ${r.status === 'verified' ? 'border-[#d4af37]/70' : 'border-red-400/40'}`}>
            <div className="min-w-0 flex-1"><p className="text-lg font-bold text-[#f6f1e4]">{r.name ? `${r.name}${r.symbol ? ` ($${r.symbol})` : ''}` : short(r.token)}</p><p className="num break-all text-[11px] text-[#8a8478]">{r.network} · {r.token}</p></div>
            {r.status === 'verified' ? <div className="text-right"><VerifiedBadge /><p className="mt-1 text-[11px] text-[#a39c8f]">Expires {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : '—'}</p></div>
              : <p className="text-sm font-bold uppercase tracking-[.14em] text-red-300" data-testid="verify-verdict">Not verified</p>}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="panel p-4"><p className="text-xs text-[#8a8478]">Wallet signature</p><p className={`font-semibold ${result.signatureValid ? 'text-green-300' : 'text-red-300'}`} data-testid="verify-signature">{result.signatureValid ? 'Valid' : 'Invalid'}</p></div>
            <div className="panel p-4 md:col-span-2"><p className="text-xs text-[#8a8478]">Controlling wallets found on-chain</p>{result.controllers.length ? <ul className="num mt-1 space-y-0.5 text-xs">{result.controllers.map((c) => <li key={c.address}><span className="text-[#d8d2c5]">{short(c.address)}</span> <span className="text-[#8a8478]">· {c.role}</span></li>)}</ul> : <p className="text-xs text-[#a39c8f]">None identified.</p>}<p className="mt-1 text-xs">Your role: <span className="text-[#f3dc95]">{r.role ?? 'not a controller'}</span></p></div>
          </div>
          {r.reasons.length > 0 && <StateBox kind="error" title="Why it did not pass"><ul className="list-disc pl-4">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul></StateBox>}
          <div className="grid gap-3 md:grid-cols-2">{r.checks.map((c) => <div key={c.id} className="panel p-4" data-testid="verify-check"><div className="flex items-center justify-between gap-2"><p className="font-semibold text-[#f6f1e4]">{c.label}{!c.required && <span className="ml-2 text-[10px] text-[#8a8478]">optional</span>}</p><span className={`border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATE[c.state]}`}>{LABEL[c.state]}</span></div><p className="mt-1 text-xs text-[#a39c8f]">{c.detail}</p></div>)}</div>
          {result.errors.length > 0 && <StateBox kind="stale" title="Some sources did not respond">{result.errors.join(' · ')}</StateBox>}
          <p className="text-[11px] text-[#8a8478]">Sources: {result.sources.join(', ')}.</p>
        </section>
      )}

      <section className="mt-8">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Currently verified</h3>
        {listed == null ? <div className="skeleton h-16" /> : listed.length === 0 ? <StateBox kind="empty" title="No tokens are Cletus Verified yet" /> :
          <ul className="grid gap-2 md:grid-cols-2" data-testid="verified-list">{listed.map((l) => <li key={`${l.network}:${l.token}`} className="panel flex items-center justify-between gap-2 p-3 text-sm"><span className="min-w-0"><span className="font-semibold text-[#f6f1e4]">{l.symbol ? `$${l.symbol}` : short(l.token)}</span> <span className="text-xs text-[#8a8478]">{networkMeta(l.network)?.name}</span><span className="block text-[10px] text-[#8a8478]" data-testid="verified-checked">{l.checkedAt ? `re-checked ${new Date(l.checkedAt).toLocaleTimeString()}` : 're-check pending'}</span></span><span className="flex items-center gap-2"><VerifiedBadge compact />{l.network === 'solana' && <Link href={`/app/audit?mint=${l.token}`} className="text-xs text-[#c9a24a]">Audit</Link>}</span></li>)}</ul>}
        <p className="mt-4 text-[11px] text-[#8a8478]">How it works: the signature proves wallet control; the audit checks {meta.kind === 'solana' ? 'mint and freeze authority' : 'owner mint privileges'}, holder concentration, liquidity, LP lock or burn and honeypot/sell-tax data where available. A check that cannot be read is never counted as a pass. Badges expire after {VERIFIED_TTL_DAYS} days. See <Link href="/legal/not-financial-advice" className="underline">Not financial advice</Link>.</p>
      </section>
    </div>
  );
}
