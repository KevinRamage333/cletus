import Link from 'next/link';
import { Card, PageHero, Section, SectionHead } from '@/components/site/ui';

export const metadata = { title: 'Developers · Cletus', description: 'Public read-only APIs, architecture notes and how to contribute to Cletus.' };

const ENDPOINTS = [
  { m: 'GET', p: '/api/market/movers', d: 'Solana movers board (DexScreener): price, market cap, 5m/1h/24h change, volume, age. Cached 15s.' },
  { m: 'GET', p: '/api/market/token?mints=<mint,...>', d: 'Best pool quote for up to 30 Solana mints.' },
  { m: 'GET', p: '/api/market/audit?mint=<mint>', d: 'Mint/freeze authority, top-holder concentration and liquidity checks from Solana RPC and DexScreener.' },
  { m: 'GET', p: '/api/verified', d: 'Tokens currently Cletus Verified (network, address, expiry). Add ?network=&token= for one token\u2019s history.' },
  { m: 'GET', p: '/api/listings', d: 'Display overlay: verified tokens and active boosts. Never used by the trading engine.' },
  { m: 'GET', p: '/api/boost', d: 'Boost tiers, whether paid boosts are open, and active boosts.' },
  { m: 'GET', p: '/api/health', d: 'Service health.' },
];

export default function DevelopersPage() {
  return (
    <>
      <PageHero eyebrow="Developers" title={<>Build with <span className="metal">verifiable data.</span></>}>Public endpoints are read-only and return market data with explicit freshness. Missing values are null, never zero.</PageHero>
      <Section>
        <SectionHead eyebrow="Public API" title="Read-only endpoints" />
        <div className="space-y-3">{ENDPOINTS.map((e) => <Card key={e.p} className="!p-4"><div className="flex flex-wrap items-center gap-3"><span className="border border-green-400/40 px-2 py-0.5 text-[10px] font-bold text-green-300">{e.m}</span><code className="num break-all text-sm text-[#e3c06a]">{e.p}</code></div><p className="mt-2 text-sm text-[#a39c8f]">{e.d}</p></Card>)}</div>
        <pre className="panel num mt-6 overflow-x-auto p-4 text-xs text-[#d8d2c5]">{`curl -s https://app.cletustechnology.dev/api/market/movers | jq '.tokens[0]'`}</pre>
      </Section>
      <div className="border-y border-[rgba(212,175,55,.12)] bg-[#08080a]"><Section>
        <div className="grid gap-6 md:grid-cols-3">
          <Card><h3 className="font-bold text-[#f6f1e4]">Engineering standards</h3><ul className="mt-3 space-y-1 text-sm text-[#a39c8f]"><li>▸ TypeScript strict, Vitest unit tests</li><li>▸ Playwright end-to-end and mobile smoke tests</li><li>▸ Fail-closed configuration</li><li>▸ No secrets in the repository</li></ul></Card>
          <Card><h3 className="font-bold text-[#f6f1e4]">Safety rules</h3><ul className="mt-3 space-y-1 text-sm text-[#a39c8f]"><li>▸ Simulation mode by default</li><li>▸ Kill switch respected everywhere</li><li>▸ Wallets connect only; users sign their own actions</li><li>▸ Never request private keys</li></ul></Card>
          <Card><h3 className="font-bold text-[#f6f1e4]">Developer verification</h3><p className="mt-3 text-sm text-[#a39c8f]">Token developers can prove wallet ownership to earn an expiring, revocable badge after human review.</p><Link href="/app/developer-verification" className="btn-line mt-4">Verify a developer wallet</Link></Card>
        </div>
      </Section></div>
      <Section>
        <SectionHead eyebrow="For token developers" title="Get Cletus Verified" />
        <div className="grid gap-6 md:grid-cols-2">
          <Card><h3 className="font-bold text-[#f6f1e4]">Cletus Verified <span className="ml-2 border border-[#d4af37]/60 px-1.5 py-0.5 text-[10px] uppercase text-[#f3dc95]">In progress</span></h3><ol className="mt-3 space-y-1 text-sm text-[#a39c8f]"><li>1. Enter your token (Solana, Ethereum, Base, BNB, Polygon or Cronos).</li><li>2. Connect the deployer, owner or authority wallet and sign a message. No transaction, no fees.</li><li>3. Cletus runs its automated audit: authorities, holder concentration, liquidity, LP lock or burn, honeypot data.</li><li>4. Pass and your token gets a gold badge on Signals, token pages and Cletus Audit for 30 days.</li></ol><p className="mt-3 text-xs text-[#8a8478]">An automated check, not investment advice or an endorsement.</p><Link href="/app/verified" className="btn-gold mt-4">Verify your token</Link></Card>
          <Card><h3 className="font-bold text-[#f6f1e4]">Token Boost <span className="ml-2 border border-[#d4af37]/60 px-1.5 py-0.5 text-[10px] uppercase text-[#f3dc95]">Payments coming soon</span></h3><p className="mt-3 text-sm text-[#a39c8f]">Promote your token in the clearly labelled Boosted row of the Signals board for 12 hours, 24 hours or 7 days. Tokens must pass basic safety checks. Boosts are advertising and never affect what Cletus trades.</p><Link href="/app/boost" className="btn-line mt-4">Check boost eligibility</Link></Card>
        </div>
        <pre className="panel num mt-6 overflow-x-auto p-4 text-xs text-[#d8d2c5]">{`# 1. challenge  POST /api/verified/challenge {"network":"solana","token":"<mint>","wallet":"<authority>"}
# 2. sign the returned message with that wallet (no transaction)
# 3. submit     POST /api/verified/submit {network, token, wallet, challenge, message, signature}`}</pre>
      </Section>
      <Section><p className="text-sm text-[#a39c8f]">Want to contribute or integrate? <Link href="/contact?topic=developer" className="text-[#e3c06a] underline">Get in touch</Link>.</p></Section>
    </>
  );
}
