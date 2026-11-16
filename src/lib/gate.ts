/**
 * Onboarding gate (pure; unit-tested). Order: sign up -> Terms -> Risk -> Financial Understanding -> Wallet -> app.
 * Every page and API outside the public allowlist is blocked until all current-version steps are complete.
 */
import type { SessionClaims } from './session';

export type Step = 'signup' | 'terms' | 'risk' | 'financial-consent' | 'wallet' | 'done';
export const STEP_ORDER: Step[] = ['signup', 'terms', 'risk', 'financial-consent', 'wallet', 'done'];

export const STEP_PAGES: Record<Exclude<Step, 'done'>, string> = {
  signup: '/signup',
  terms: '/onboarding/terms',
  risk: '/onboarding/risk',
  'financial-consent': '/onboarding/financial-consent',
  wallet: '/onboarding/wallet',
};

const STEP_APIS: Array<[string, Step]> = [
  ['/api/onboarding/terms', 'terms'],
  ['/api/onboarding/risk', 'risk'],
  ['/api/onboarding/financial-consent', 'financial-consent'],
  ['/api/onboarding/wallet', 'wallet'],
];

const PUBLIC_PREFIXES = ['/signup', '/api/auth/', '/api/health', '/api/live', '/api/owner', '/api/internal/owner-snapshot', '/owner', '/live', '/_next/', '/favicon', '/icon', '/robots.txt',
  '/cletus-hero.jpg', '/cletus-avatar.png', '/cletus-logo.png', '/og-image.jpg', '/apple-touch-icon.png'];
PUBLIC_PREFIXES.push('/whitepaper', '/cletus-whitepaper.pdf');

export function requiredStep(
  s: SessionClaims | null,
  currentTermsVersion: string,
  currentRiskVersion = currentTermsVersion,
  currentFinancialConsentVersion = currentTermsVersion,
): Step {
  if (!s) return 'signup';
  if (s.tv !== currentTermsVersion) return 'terms';
  if (s.rv !== currentRiskVersion) return 'risk';
  if (s.fc !== currentFinancialConsentVersion) return 'financial-consent';
  if (!s.w) return 'wallet';
  return 'done';
}

export type GateDecision = { action: 'next' } | { action: 'redirect'; to: string } | { action: 'deny'; status: 401 | 403; step: Step };

export function gateDecision(
  pathname: string,
  s: SessionClaims | null,
  currentTermsVersion: string,
  currentRiskVersion = currentTermsVersion,
  currentFinancialConsentVersion = currentTermsVersion,
): GateDecision {
  if (PUBLIC_PREFIXES.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p))) return { action: 'next' };
  const step = requiredStep(s, currentTermsVersion, currentRiskVersion, currentFinancialConsentVersion);
  const reached = STEP_ORDER.indexOf(step);
  const isApi = pathname.startsWith('/api/');

  // Onboarding pages/APIs: allowed only up to the step the user has reached.
  const pageStep = (Object.entries(STEP_PAGES) as Array<[Step, string]>).find(([, p]) => pathname === p)?.[0];
  const apiStep = STEP_APIS.find(([p]) => pathname === p || pathname.startsWith(p + '/'))?.[1];
  const onboardingStep = pageStep ?? apiStep;
  if (onboardingStep && onboardingStep !== 'signup') {
    if (!s) return isApi ? { action: 'deny', status: 401, step } : { action: 'redirect', to: STEP_PAGES.signup };
    if (STEP_ORDER.indexOf(onboardingStep) <= reached) return { action: 'next' };
    return isApi ? { action: 'deny', status: 403, step } : { action: 'redirect', to: STEP_PAGES[step as Exclude<Step, 'done'>] };
  }

  if (pathname === '/api/auth/logout' || pathname === '/logout') return { action: 'next' };
  if (step === 'done') return { action: 'next' };
  if (isApi) return { action: 'deny', status: s ? 403 : 401, step };
  return { action: 'redirect', to: STEP_PAGES[step as Exclude<Step, 'done'>] };
}

/** Demo-mode gate (public preview without a database). Pure; unit-tested. */
const DEMO_PUBLIC = ['/demo', '/live', '/owner', '/legal', '/api/demo/', '/api/live', '/api/owner', '/api/internal/owner-snapshot', '/api/health', '/_next/', '/favicon', '/icon', '/robots.txt',
  '/cletus-hero.jpg', '/cletus-avatar.png', '/cletus-logo.png', '/og-image.jpg', '/apple-touch-icon.png'];
DEMO_PUBLIC.push('/whitepaper', '/cletus-whitepaper.pdf');
export type DemoDecision = { action: 'next' } | { action: 'redirect'; to: string } | { action: 'soon' };
export function demoGateDecision(pathname: string): DemoDecision {
  if (pathname === '/' || pathname === '/signup') return { action: 'redirect', to: '/demo' };
  if (DEMO_PUBLIC.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p))) return { action: 'next' };
  if (/\.(png|jpe?g|svg|webp|ico|txt|xml|webmanifest|pdf)$/.test(pathname)) return { action: 'next' };
  if (pathname.startsWith('/api/')) return { action: 'soon' };
  return { action: 'redirect', to: `/demo?soon=${encodeURIComponent(pathname)}` };
}
