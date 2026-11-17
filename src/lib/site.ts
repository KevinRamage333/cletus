/** Public brand coordinates. The corporate site and the application are separate products on two hostnames. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://cletustechnology.dev';
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.cletustechnology.dev';
export const SITE_HOST = 'cletustechnology.dev';
export const APP_HOST = 'app.cletustechnology.dev';
export const BRAND = 'Cletus';
export const TAGLINE = 'The Autonomous Trading & Financial Intelligence Ecosystem';
/** Contact inbox is published only when configured; the site never invents an address. */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || '';

export const SITE_NAV = [
  { href: '/about', label: 'About' },
  { href: '/technology', label: 'Technology' },
  { href: '/features', label: 'Features' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/sponsors', label: 'Benefactors' },
  { href: '/developers', label: 'Developers' },
  { href: '/contact', label: 'Contact' },
] as const;

export const LEGAL_NAV = [
  { href: '/legal/risk', label: 'Risk Disclosure' },
  { href: '/legal/terms', label: 'Terms of Use' },
  { href: '/legal/privacy', label: 'Privacy Policy' },
  { href: '/legal/not-financial-advice', label: 'Not Financial Advice' },
] as const;

export const SITE_DISCLAIMER =
  'Cletus is experimental, simulation-first software. Live trading is not enabled on this platform. Nothing here is financial, investment, legal or tax advice. ' +
  'Digital assets are highly volatile and you can lose all of the money you commit. Paper-trading and illustrative figures are not projections and do not guarantee future results. ' +
  'No Cletus token, staking program or revenue-sharing arrangement is currently offered.';
