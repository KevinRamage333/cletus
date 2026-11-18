import './globals.css';
import type { Metadata, Viewport } from 'next';
import { SITE_URL, TAGLINE } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `Cletus · ${TAGLINE}`, template: '%s' },
  description: 'Cletus is an intelligent, simulation-first crypto trading and financial intelligence ecosystem: signals, paper trading, audits, portfolio, community and multi-chain wallets. Not financial advice.',
  applicationName: 'Cletus',
  icons: { icon: [{ url: '/favicon.ico' }, { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' }], apple: '/apple-touch-icon.png' },
  openGraph: {
    title: 'Cletus · Autonomous trading & financial intelligence',
    description: 'Transparency over hype. Simulation-first. Live trading not enabled. Not financial advice.',
    url: SITE_URL,
    siteName: 'Cletus Technology',
    images: [{ url: '/og-image.jpg', width: 1200, height: 630, alt: 'Cletus, the golden central AI intelligence' }],
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: 'Cletus · Financial intelligence ecosystem', images: ['/og-image.jpg'] },
};

export const viewport: Viewport = { themeColor: '#050506', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
