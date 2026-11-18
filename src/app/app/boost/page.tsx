'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader, StateBox } from '@/components/app/ui';
import { BoostedTag } from '@/components/listings/Listings';
import { BOOST_DISCLOSURE, BOOST_TIERS, type BoostSummary, type BoostTierId } from '@/lib/token-boost';
import { LISTING_NETWORKS, networkMeta, normalizeAddress, type ListingNetwork } from '@/lib/verified';

type Quote = { tier: BoostTierId; label: string; priceUsd: number | null; startsAt: string; expiresAt: string; name: string | null; symbol: string | null };
type Outcome = { kind: 'pending'; quote: Quote; message: string } | { kind: 'rejected'; reasons: string[] } | { kind: 'error'; message: string };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function BoostPage() {
  const [network, setNetwork] = useState<ListingNetwork>('solana');
  const [token, setToken] = useState('');
  const [tier, setTier] = useState<BoostTierId>('24h');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Outcome | null>(null);
  const [info, setInfo] = useState<{ paymentsEnabled: boolean; boosts: BoostSummary[] } | null>(null);
  useEffect(() => { fetch('/api/boost', { cache: 'no-store' }).then((r) => r.json()).then(setInfo).catch(() => setInfo({ paymentsEnabled: false, boosts: [] })); }, []);
  const meta = networkMeta(network)!;

  const checkout = async (e: React.FormEvent) => {
    e.preventDefault(); setOut(null);
    if (!normalizeAddress(network, token)) { setOut({ kind: 'error', message: `Enter a valid ${meta.name} token address.` }); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/boost/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ network, token: token.trim(), tier }), signal: AbortSignal.timeout(45_000) });
      const j = await r.json();
      if (r.status === 422) setOut({ kind: 'rejected', reasons: j.reasons ?? [j.error] });
      else if (j.quote) setOut({ kind: 'pending', quote: j.quote, message: j.message });
      else setOut({ kind: 'error', message: j.error || `Checkout failed (HTTP ${r.status})` });
    } catch (err) { setOut({ kind: 'error', message: (err as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader eyebrow="For token projects" title={<>Token <span className="metal">Boost</span></>}>
        Promote your token in the Boosted row at the top of the Signals board with a gold Boosted tag. Boosts are paid placement only: they never change what Cletus trades.
      </PageHeader>
      <StateBox kind="info" title="Paid boosts: coming soon, pending approval">Checkout is built, but payment collection is switched off. You can check eligibility and see your boost window; nothing is charged.</StateBox>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form onSubmit={checkout} className="panel panel-hi space-y-4 p-5" data-testid="boost-form">
          <h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Token</h3>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Network">
            {LISTING_NETWORKS.map((n) => <button key={n.id} type="button" role="radio" aria-checked={network === n.id} onClick={() => setNetwork(n.id)} className={`border px-2.5 py-1 text-xs font-semibold ${network === n.id ? 'border-[#d4af37] bg-[#d4af37]/15 text-[#f3dc95]' : 'border-white/10 text-[#a39c8f] hover:text-[#f2ede2]'}`}>{n.name}</button>)}
          </div>
          <input className="field num text-xs" value={token} onChange={(e) => setToken(e.target.value)} placeholder={meta.kind === 'solana' ? 'Solana token mint address' : '0x… token contract address'} aria-label="Token address" data-testid="boost-token" />
          {network !== 'solana' && <p className="text-[11px] text-[#8a8478]">The Signals board is Solana-only today; EVM boosts will display when EVM boards launch.</p>}
          <h3 className="pt-2 text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Duration</h3>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Boost duration">
            {BOOST_TIERS.map((t) => <button key={t.id} type="button" role="radio" aria-checked={tier === t.id} onClick={() => setTier(t.id)} data-testid={`boost-tier-${t.id}`} className={`border p-3 text-left ${tier === t.id ? 'border-[#d4af37] bg-[#d4af37]/10' : 'border-white/10 hover:border-white/25'}`}><p className="font-bold text-[#f6f1e4]">{t.label}</p><p className="text-[11px] text-[#8a8478]">{t.priceUsd == null ? 'Price TBA' : `$${t.priceUsd}`}</p></button>)}
          </div>
          <button className="btn-gold w-full" disabled={busy} data-testid="boost-checkout">{busy ? 'Checking safety…' : 'Check eligibility & continue'}</button>
          <p className="text-[11px] text-[#8a8478]">{BOOST_DISCLOSURE}</p>
        </form>
        <div className="space-y-4">
          {out?.kind === 'pending' && <section className="panel border border-[#d4af37]/60 p-5" data-testid="boost-quote"><div className="flex items-center justify-between gap-2"><p className="font-bold text-[#f6f1e4]">{out.quote.symbol ? `$${out.quote.symbol}` : short(token)} passes the safety checks</p><BoostedTag /></div><dl className="num mt-3 grid grid-cols-2 gap-y-1 text-xs"><dt className="text-[#8a8478]">Duration</dt><dd>{out.quote.label}</dd><dt className="text-[#8a8478]">Would start</dt><dd>{new Date(out.quote.startsAt).toLocaleString()}</dd><dt className="text-[#8a8478]">Would end</dt><dd>{new Date(out.quote.expiresAt).toLocaleString()}</dd><dt className="text-[#8a8478]">Price</dt><dd>{out.quote.priceUsd == null ? 'To be announced' : `$${out.quote.priceUsd}`}</dd></dl><p className="mt-3 text-sm text-[#f3dc95]" data-testid="boost-pending">{out.message}</p><button className="btn-line mt-3 w-full" disabled>Pay — coming soon</button></section>}
          {out?.kind === 'rejected' && <StateBox kind="error" title="Not eligible for boosting"><ul className="list-disc pl-4">{out.reasons.map((x) => <li key={x}>{x}</li>)}</ul></StateBox>}
          {out?.kind === 'error' && <StateBox kind="error" title="Checkout could not complete">{out.message}</StateBox>}
          <section className="panel p-5"><h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Rules</h3><ul className="mt-3 space-y-1 text-sm text-[#a39c8f]"><li>▸ Must pass basic safety: mint and freeze authority revoked (Solana) or no owner minting (EVM), at least $10K liquidity, no honeypot flag, sell tax 10% or less.</li><li>▸ Shown with a clearly labelled gold Boosted tag in a separate row.</li><li>▸ Expires automatically after its duration; boosts on the same token stack.</li><li>▸ Has no effect on Cletus&apos;s trading decisions, signals or audit results.</li><li>▸ Want a badge too? <Link href="/app/verified" className="text-[#e3c06a] underline">Get Cletus Verified</Link>.</li></ul></section>
          <section className="panel p-5"><h3 className="text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Boosted now</h3>{info == null ? <div className="skeleton mt-3 h-10" /> : info.boosts.length === 0 ? <p className="mt-2 text-sm text-[#8a8478]">No active boosts.</p> : <ul className="num mt-2 space-y-1 text-xs" data-testid="boost-active">{info.boosts.map((b) => <li key={`${b.network}:${b.token}`} className="flex justify-between gap-2"><span>{b.network} · {short(b.token)}</span><span className="text-[#8a8478]">until {new Date(b.expiresAt).toLocaleString()}{b.checkedAt ? ` · checked ${new Date(b.checkedAt).toLocaleTimeString()}` : ''}</span></li>)}</ul>}</section>
        </div>
      </div>
    </div>
  );
}
