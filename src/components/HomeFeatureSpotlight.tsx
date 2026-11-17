import Link from 'next/link';
const features = [
  { href: '/app/discover', icon: '📈', title: 'Pump-Style Coin Scanner', detail: 'Scanned tokens · Cletus grades · chart & paper signals' },
  { href: '/app/community', icon: '📊', title: 'Community P&L', detail: 'Anonymous aggregate paper performance and live community chat' },
  { href: '/app/auditor', icon: '🛡️', title: 'Cletus Auditor', detail: 'Coin security · Cletus score · verification status' },
  { href: '/app/dev-wallet', icon: '🔎', title: 'Dev Wallet Inspector', detail: 'Solana wallet holdings · transactions · risk evidence' },
];
export default function HomeFeatureSpotlight() {
  return <section aria-label="Cletus tools" className="border-b border-[#D4AF37]/20 bg-[#090909] px-4 py-6 text-white sm:px-6">
    <div className="mx-auto max-w-6xl space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#D4AF37]">Cletus · The Golden One</p><h2 className="mt-1 text-2xl font-black sm:text-3xl">AI-powered trading research and community</h2><p className="mt-2 max-w-3xl text-sm text-white/60">Meet Cletus: a multi-signal coin scanner, paper-trading assistant and on-chain risk researcher. Explore his token grades, wallet inspections and community performance. Simulated trading only; scores are not guarantees.</p></div><Link href="/app" className="rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-bold text-black">Open Command Center →</Link></div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{features.map(f=><Link key={f.href} href={f.href} className="rounded-xl border border-[#D4AF37]/30 bg-[#15120b] p-4 transition-colors hover:border-[#D4AF37]"><span className="text-2xl" aria-hidden="true">{f.icon}</span><h3 className="mt-2 font-bold text-[#E5C76B]">{f.title} →</h3><p className="mt-1 text-xs leading-relaxed text-white/60">{f.detail}</p></Link>)}</div><p className="text-xs text-white/45">Developer verification checkmarks require separate human review and are not automatically issued by a token grade.</p></div>
  </section>;
}
