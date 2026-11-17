import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  APPROVAL_TTL_MS, canApprove, canReject, effectiveStatus, expiresAtFrom,
  formatTimer, operatorFeeUsd, remainingMs, solscanAccountUrl, solscanTxUrl, tradeFeeView,
} from '@/lib/approvals';
import { SUPPORTED_WALLETS, isMobileUserAgent, inWalletBrowser, WALLET_CONNECT_COPY, findSupportedAdapter, extraDetectedWallets, JUPITER_MOBILE_STEPS } from '@/lib/connect-wallets';
import { TERMS_VERSION, TERMS_SECTIONS, RISK_POINTS } from '@/lib/legal';
import { validateWalletSetup } from '@/lib/onboarding';
import { userSwapExecuteAllowed } from '@/lib/user-swaps';

describe('approval queue state machine', () => {
  const pending = {
    id: 'a1', status: 'pending' as const, side: 'buy' as const, mint: 'Mint111111111111111111111111111111111111111',
    symbol: 'BONK', sizeUsd: 100, expiresAt: expiresAtFrom(1_000, 60_000),
    transaction: 'dGVzdA==', operatorFeeBps: 50, operatorFeeUsd: 0.5,
  };
  it('expires pending suggestions after the timer and blocks approve/reject once resolved', () => {
    expect(effectiveStatus(pending, 1_000)).toBe('pending');
    expect(canApprove(pending, 1_000).ok).toBe(true);
    expect(canReject(pending, 1_000).ok).toBe(true);
    expect(effectiveStatus(pending, 1_000 + APPROVAL_TTL_MS + 1)).toBe('expired');
    expect(canApprove(pending, 1_000 + APPROVAL_TTL_MS + 1).ok).toBe(false);
    expect(canApprove({ ...pending, transaction: null }, 1_000).ok).toBe(false);
    expect(canApprove({ ...pending, status: 'executed' }, 1_000).ok).toBe(false);
    expect(canReject({ ...pending, status: 'rejected' }, 1_000).ok).toBe(false);
    expect(remainingMs(pending.expiresAt, 31_000)).toBe(30_000);
    expect(formatTimer(5_000)).toBe('5s');
    expect(formatTimer(65_000)).toBe('1:05');
  });
});

describe('operator fee display', () => {
  it('shows 0.5% ($0.50 on $100) on entry and adds the exit leg when known', () => {
    expect(operatorFeeUsd(100, 50)).toBe(0.5);
    expect(operatorFeeUsd(200, 50)).toBe(1);
    const open = tradeFeeView({ sizeUsd: 100, feesUsd: 0.62 });
    expect(open.entryOperatorFeeUsd).toBe(0.5);
    expect(open.exitOperatorFeeUsd).toBe(0);
    const closed = tradeFeeView({ sizeUsd: 100, feesUsd: 1.1, tokenAmount: 50, exitPrice: 2.2 });
    expect(closed.operatorFeeBps).toBe(50);
    expect(closed.entryOperatorFeeUsd).toBe(0.5);
    expect(closed.exitOperatorFeeUsd).toBeCloseTo(0.55, 6);
    expect(closed.operatorFeeUsd).toBeCloseTo(1.05, 6);
  });
});

describe('Solscan links', () => {
  it('builds account links and only links plausible signatures', () => {
    expect(solscanAccountUrl('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263')).toContain('/account/DezX');
    expect(solscanTxUrl(null)).toBeNull();
    expect(solscanTxUrl('short')).toBeNull();
    expect(solscanTxUrl('5'.repeat(64))!.startsWith('https://solscan.io/tx/')).toBe(true);
  });
});

describe('no custody in user-swap and onboarding wallet UI', () => {
  it('user-swaps and approval-store never load a signing key or mention session keys', () => {
    for (const file of ['src/lib/user-swaps.ts', 'src/lib/approval-store.ts', 'src/lib/approvals.ts', 'src/app/onboarding/wallet/page.tsx', 'src/components/ConnectWallet.tsx']) {
      const src = readFileSync(resolve(file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/\bloadTradingKeypair\b/);
      expect(src).not.toMatch(/TRADING_WALLET_PRIVATE_KEY/);
      expect(src).not.toMatch(/\bgenerateMnemonic\b|\bencryptSecret\b|\bsaveEncryptedWallet\b/);
      expect(src).not.toMatch(/sessionKey/);
    }
  });

  it('the onboarding wallet page does not offer create or import of a seed', () => {
    const src = readFileSync(resolve('src/app/onboarding/wallet/page.tsx'), 'utf8');
    expect(src).toMatch(/ConnectWallet/);
    expect(src).not.toMatch(/Generate wallet|Import existing|recovery phrase/);
  });
});

describe('supported wallets and copy', () => {
  it('lists Jupiter first, then Phantom, Solflare and Backpack, with mobile fallbacks', () => {
    expect(SUPPORTED_WALLETS.map((w) => w.id)).toEqual(['jupiter', 'phantom', 'solflare', 'backpack']);
    const url = 'https://cletus-autonomous-trader.vercel.app/demo/wallet';
    const jupiter = SUPPORTED_WALLETS[0];
    expect(jupiter.adapterNames).toContain('Jupiter');
    expect(jupiter.browseDeepLink).toBeUndefined();
    expect(jupiter.mobileOpenHint).toMatch(/globe icon/i);
    expect(SUPPORTED_WALLETS[1].browseDeepLink!(url)).toContain('phantom.app/ul/browse/');
    expect(SUPPORTED_WALLETS[2].browseDeepLink!(url)).toContain('solflare.com/ul/v1/browse/');
    expect(SUPPORTED_WALLETS[3].browseDeepLink!(url)).toContain('backpack.app');
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isMobileUserAgent('Mozilla/5.0 (Macintosh)')).toBe(false);
    expect(inWalletBrowser('Phantom/1.0')).toBe(true);
    expect(inWalletBrowser('Mozilla/5.0 JupiterMobile/2.0')).toBe(true);
    expect(WALLET_CONNECT_COPY.headline.toLowerCase()).toContain('control');
    expect(WALLET_CONNECT_COPY.body).toMatch(/never stores or sees your private keys/i);
    expect(WALLET_CONNECT_COPY.body).toMatch(/own volition/i);
  });
});

describe('wallet standard matching', () => {
  it('matches Jupiter under either Standard name and lists leftover wallets', () => {
    const jup = SUPPORTED_WALLETS[0];
    const wallets = [
      { adapter: { name: 'Jupiter' }, readyState: 'Installed' },
      { adapter: { name: 'Mobile Wallet Adapter' }, readyState: 'Installed' },
      { adapter: { name: 'Phantom' }, readyState: 'Installed' },
      { adapter: { name: 'Weird Wallet' }, readyState: 'Unsupported' },
    ];
    expect(findSupportedAdapter(wallets, jup)?.adapter.name).toBe('Jupiter');
    expect(findSupportedAdapter([{ adapter: { name: 'Jupiter Wallet' } }], jup)?.adapter.name).toBe('Jupiter Wallet');
    expect(extraDetectedWallets(wallets).map((w) => w.adapter.name)).toEqual(['Mobile Wallet Adapter']);
    expect(JUPITER_MOBILE_STEPS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('terms and wallet setup', () => {
  it('Terms v2026-11-16.2 describe non-custodial connect, SIWS auth-only, per-trade approval and disconnect', () => {
    expect(TERMS_VERSION).toBe('2026-11-16.2');
    const wallet = TERMS_SECTIONS.find((s) => s.title.startsWith('6.'));
    const body = wallet!.body.join(' ');
    expect(body).toMatch(/non-custodial/i);
    expect(body).toMatch(/Sign-In-With-Solana/);
    expect(body).toMatch(/not a transaction/);
    expect(body).toMatch(/disconnect/);
    expect(body).toMatch(/own volition/);
    expect(body).not.toMatch(/Wallets created in the browser/);
    expect(RISK_POINTS.some((p) => /own volition|paper mode/i.test(p))).toBe(true);
  });
  it('paper mode does not require a public key', () => {
    expect(validateWalletSetup({ source: 'paper' }, true, true, true, true)).toMatchObject({ ok: true, source: 'paper' });
  });
});


describe('user swap execute mode gate', () => {
  it('forbids simulation and live-without-flag, allows live with the explicit flag', () => {
    expect(userSwapExecuteAllowed('simulation', {})).toMatchObject({ ok: false, status: 403 });
    expect(userSwapExecuteAllowed('live', {})).toMatchObject({ ok: false, status: 403 });
    expect(userSwapExecuteAllowed('live', { USER_SWAP_EXECUTE_ENABLED: 'false' }).ok).toBe(false);
    expect(userSwapExecuteAllowed('live', { USER_SWAP_EXECUTE_ENABLED: 'true' })).toEqual({ ok: true });
  });
});