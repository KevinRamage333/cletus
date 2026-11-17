/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@solana/wallet-adapter-base',
    '@solana/wallet-adapter-react',
    '@solana/wallet-adapter-phantom',
    '@solana/wallet-adapter-solflare',
    '@solana/wallet-adapter-backpack',
  ],
  webpack: (config) => {
    config.resolve.fallback = { ...(config.resolve.fallback || {}), fs: false, net: false, tls: false, crypto: false };
    config.resolve.alias = { ...(config.resolve.alias || {}), 'react-native': false };
    return config;
  },
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['@prisma/client', 'pg'],
  },
  async redirects() {
    // The guest /demo pages were replaced by the public corporate site and the read-only app screens.
    return [
      { source: '/demo', destination: '/app', permanent: false },
      { source: '/demo/:path*', destination: '/app', permanent: false },
      { source: '/brain', destination: '/app/ai', permanent: false },
      { source: '/tax', destination: '/app/tax', permanent: false },
      { source: '/grove', destination: '/roadmap', permanent: false },
      { source: '/app/discover', destination: '/app/signals', permanent: false },
      { source: '/app/auditor', destination: '/app/audit', permanent: false },
      { source: '/app/staking', destination: '/roadmap', permanent: false },
      { source: '/app/world', destination: '/roadmap', permanent: false },
    ];
  },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
    ] }];
  },
};
module.exports = nextConfig;
