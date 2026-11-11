import './globals.css';
import type { Metadata } from 'next';

const site = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: 'Cletus: Autonomous Solana Trader (Beta)',
  description: 'Cletus, the golden goose: a self-learning, self-healing autonomous Solana trading system with a Brain you can talk to. Simulation-first beta. Not financial advice.',
  icons: { icon: [{ url: '/favicon.ico' }, { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' }], apple: '/apple-touch-icon.png' },
  openGraph: {
    title: 'Cletus: the autonomous Solana trading goose',
    description: 'Self-learning, self-healing, world-aware. Simulation-first beta. Not financial advice; losses happen.',
    images: [{ url: '/og-image.jpg', width: 1200, height: 630, alt: 'Cletus, a golden goose wearing headphones, surrounded by glowing gold coins on a black circuit background' }],
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: 'Cletus: autonomous Solana trader', images: ['/og-image.jpg'] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
