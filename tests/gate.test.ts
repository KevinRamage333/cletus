import { describe, it, expect } from 'vitest';
import { gateDecision, requiredStep } from '@/lib/gate';
import { signSession, verifySession, type SessionClaims } from '@/lib/session';
import { validateTermsAcceptance, validateRiskAck, validateWalletSetup } from '@/lib/onboarding';
import { Keypair } from '@solana/web3.js';

const V = '2026-11-11.1';
const sess = (o: Partial<SessionClaims> = {}): SessionClaims => ({ uid: 'u1', email: 'a@b.co', adm: false, tv: null, rv: null, w: false, iat: 0, exp: 9e9, ...o });
const done = sess({ tv: V, rv: V, w: true });

describe('onboarding gate: step order', () => {
  it('signup -> terms -> risk -> wallet -> done', () => {
    expect(requiredStep(null, V)).toBe('signup');
    expect(requiredStep(sess(), V)).toBe('terms');
    expect(requiredStep(sess({ tv: V }), V)).toBe('risk');
    expect(requiredStep(sess({ tv: V, rv: V }), V)).toBe('wallet');
    expect(requiredStep(done, V)).toBe('done');
  });
  it('bumping the terms version forces re-acceptance of terms AND risk', () => {
    expect(requiredStep(done, '2027-01-01.1')).toBe('terms');
    expect(gateDecision('/', done, '2027-01-01.1')).toEqual({ action: 'redirect', to: '/onboarding/terms' });
  });
});

describe('onboarding gate: route blocking', () => {
  it('anonymous users are redirected to sign-up for pages and get 401 for APIs', () => {
    expect(gateDecision('/', null, V)).toEqual({ action: 'redirect', to: '/signup' });
    expect(gateDecision('/feedback', null, V)).toEqual({ action: 'redirect', to: '/signup' });
    expect(gateDecision('/api/status', null, V)).toMatchObject({ action: 'deny', status: 401 });
    expect(gateDecision('/onboarding/terms', null, V)).toEqual({ action: 'redirect', to: '/signup' });
  });
  it('public routes stay reachable', () => {
    for (const p of ['/signup', '/api/auth/signup', '/api/health', '/_next/static/x.js']) expect(gateDecision(p, null, V)).toEqual({ action: 'next' });
  });
  it('every app page and API is blocked until all three steps are complete', () => {
    for (const s of [sess(), sess({ tv: V }), sess({ tv: V, rv: V })]) {
      for (const p of ['/', '/feedback']) expect(gateDecision(p, s, V).action).toBe('redirect');
      for (const p of ['/api/status', '/api/brain', '/api/kill-switch', '/api/feedback', '/api/account', '/api/engine/scan']) expect(gateDecision(p, s, V)).toMatchObject({ action: 'deny', status: 403 });
    }
    expect(gateDecision('/', done, V)).toEqual({ action: 'next' });
    expect(gateDecision('/api/status', done, V)).toEqual({ action: 'next' });
  });
  it('steps cannot be skipped', () => {
    expect(gateDecision('/onboarding/risk', sess(), V)).toEqual({ action: 'redirect', to: '/onboarding/terms' });
    expect(gateDecision('/onboarding/wallet', sess({ tv: V }), V)).toEqual({ action: 'redirect', to: '/onboarding/risk' });
    expect(gateDecision('/api/onboarding/risk', sess(), V)).toMatchObject({ action: 'deny', status: 403 });
    expect(gateDecision('/api/onboarding/wallet', sess({ tv: V }), V)).toMatchObject({ action: 'deny', status: 403 });
    expect(gateDecision('/api/onboarding/terms', sess(), V)).toEqual({ action: 'next' });
    expect(gateDecision('/onboarding/wallet', sess({ tv: V, rv: V }), V)).toEqual({ action: 'next' });
  });
});

describe('session cookie', () => {
  const secret = 'x'.repeat(40);
  it('round-trips and rejects tampering or the wrong secret', async () => {
    const t = await signSession({ uid: 'u1', email: 'a@b.co', adm: false, tv: V, rv: V, w: true }, secret);
    expect((await verifySession(t, secret))?.uid).toBe('u1');
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 'u1', tv: V, rv: V, w: true, exp: 9e9 })).toString('base64url');
    expect(await verifySession(`${forged}.${sig}`, secret)).toBeNull();
    expect(await verifySession(`${body}.${sig}`, 'y'.repeat(40))).toBeNull();
    expect(await verifySession('garbage', secret)).toBeNull();
  });
  it('rejects expired sessions', async () => {
    const t = await signSession({ uid: 'u1', email: 'a@b.co', adm: false, tv: V, rv: V, w: true }, secret, -10);
    expect(await verifySession(t, secret)).toBeNull();
  });
});

describe('onboarding API validation', () => {
  it('terms require current version, scroll-to-end and the read checkbox', () => {
    expect(validateTermsAcceptance({ version: V, scrolledToEnd: true, readConfirmed: true }, V).ok).toBe(true);
    expect(validateTermsAcceptance({ version: V, scrolledToEnd: false, readConfirmed: true }, V).ok).toBe(false);
    expect(validateTermsAcceptance({ version: V, scrolledToEnd: true, readConfirmed: false }, V).ok).toBe(false);
    expect(validateTermsAcceptance({ version: 'old', scrolledToEnd: true, readConfirmed: true }, V).ok).toBe(false);
  });
  it('risk acknowledgement requires accepted current terms', () => {
    expect(validateRiskAck({ version: V, acknowledged: true }, V, V).ok).toBe(true);
    expect(validateRiskAck({ version: V, acknowledged: true }, V, null).ok).toBe(false);
    expect(validateRiskAck({ version: V, acknowledged: false }, V, V).ok).toBe(false);
  });
  it('wallet step accepts only a valid public key and refuses secrets', () => {
    const pk = Keypair.generate().publicKey.toBase58();
    expect(validateWalletSetup({ publicKey: pk, source: 'created' }, true, true).ok).toBe(true);
    expect(validateWalletSetup({ publicKey: pk, source: 'created' }, true, false).ok).toBe(false);
    expect(validateWalletSetup({ publicKey: 'not-a-key', source: 'imported' }, true, true).ok).toBe(false);
    expect(validateWalletSetup({ publicKey: pk, source: 'created', mnemonic: 'abandon ...' }, true, true).ok).toBe(false);
  });
});
