import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cletus — Autonomous Solana Trader (Beta)',
  description: 'Simulation-first autonomous Solana micro-cap trading bot dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
