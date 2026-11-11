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
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
    ] }];
  },
};
module.exports = nextConfig;
