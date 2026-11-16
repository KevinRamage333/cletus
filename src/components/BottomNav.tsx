'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const NAV = [
  { href: '/app', label: 'Dashboard', icon: '📊' },
  { href: '/app/chart', label: 'Chart', icon: '📈' },
  { href: '/app/signals', label: 'Signals', icon: '⚡' },
  { href: '/app/ai', label: 'Cletus AI', icon: '🪿' },
  { href: '/app/world', label: 'The Grove', icon: '🌳' },
  { href: '/app/trade', label: 'Simulate', icon: '▶️' },
  { href: '/app/config', label: 'Config', icon: '⚙️' },
  { href: '/app/community', label: 'Community', icon: '💬' },
  { href: '/app/dev-wallet', label: 'Dev Wallet', icon: '🔎' },
];

/** Bottom tab bar on mobile, top tab strip on desktop. */
export default function BottomNav() {
  const path = usePathname();
  const active = (h: string) => (h === '/app' ? path === '/app' : path?.startsWith(h));
  return (
    <>
      <nav className="hidden md:block sticky top-0 z-40 border-b border-white/10 bg-black/90 backdrop-blur">
        <div className="max-w-5xl mx-auto flex items-center gap-1 px-4 py-2 overflow-x-auto">
          <Link href="/" className="flex items-center gap-2 mr-3 shrink-0"><img src="/cletus-logo.png" alt="" width={24} height={24} className="rounded-full" /><span className="font-bold gold-text">Cletus</span></Link>
          {NAV.map((t) => (
            <Link key={t.href} href={t.href} className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap ${active(t.href) ? 'bg-[#D4AF37]/15 text-[#E5C76B] border border-[#D4AF37]/40' : 'text-white/60 hover:text-white'}`}>{t.icon} {t.label}</Link>
          ))}
          <span className="ml-auto flex gap-2 shrink-0 text-[11px] text-white/40">
            <Link href="/app/wallet" className="hover:text-white">Wallet</Link>·<Link href="/tax" className="hover:text-white">Tax</Link>·<Link href="/app/staking" className="hover:text-white">Staking</Link>·<Link href="/whitepaper" className="hover:text-white">Whitepaper</Link>·<Link href="/" className="hover:text-white">Engine</Link>
          </span>
        </div>
      </nav>
      <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-[#D4AF37]/20 bg-black/95 backdrop-blur z-50" aria-label="Main">
        <div className="flex overflow-x-auto px-1 py-2">
          {NAV.map((t) => (
            <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-0.5 min-w-[64px] flex-1 text-[10px] ${active(t.href) ? 'text-[#E5C76B]' : 'text-white/50'}`}>
              <span className="text-base leading-none">{t.icon}</span><span className="whitespace-nowrap">{t.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
