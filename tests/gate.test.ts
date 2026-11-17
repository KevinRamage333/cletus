import { describe, it, expect } from 'vitest';
import { gateDecision, requiredStep } from '@/lib/gate';
import { signSession, verifySession, type SessionClaims } from '@/lib/session';
import { validateAgeAttestation, validateTermsAcceptance, validateRiskAck, validateWalletSetup } from '@/lib/onboarding';
import { AGE_ATTESTATION_VERSION } from '@/lib/age';
import { FINANCIAL_CONSENT_STAGES, FINANCIAL_CONSENT_VERSION, validateFinancialConsentStage } from '@/lib/financial-consent';
import { Keypair } from '@solana/web3.js';

const V = '2026-11-11.1';
const FC = FINANCIAL_CONSENT_VERSION;
const sess = (o: Partial<SessionClaims> = {}): SessionClaims => ({ uid: 'u1', email: 'a@b.co', adm: false, av: AGE_ATTESTATION_VERSION, tv: null, rv: null, fc: null, w: false, iat: 0, exp: 9e9, ...o });
const done = sess({ tv: V, rv: V, fc: FC, w: true });

describe('onboarding gate: step order', () => {
  it('signup -> 18+ eligibility -> terms -> risk -> financial understanding -> wallet -> done', () => {
    expect(requiredStep(null, V, V, FC)).toBe('signup');
    expect(requiredStep(sess({ av: null }), V, V, FC)).toBe('age');
    expect(requiredStep(sess(), V, V, FC)).toBe('terms');
    expect(requiredStep(sess({ tv: V }), V, V, FC)).toBe('risk');
    expect(requiredStep(sess({ tv: V, rv: V }), V, V, FC)).toBe('financial-consent');
    expect(requiredStep(sess({ tv: V, rv: V, fc: FC }), V, V, FC)).toBe('wallet');
    expect(requiredStep(done, V, V, FC)).toBe('done');
  });
  it('bumping the terms version forces re-acceptance of terms and all downstream steps', () => {
    expect(requiredStep(done, '2027-01-01.1', '2027-01-01.1', FC)).toBe('terms');
    expect(gateDecision('/', done, '2027-01-01.1', '2027-01-01.1', FC)).toEqual({ action: 'redirect', to: '/onboarding/terms' });
  });
  it('bumping financial consent version requires the five stages again', () => {
    expect(requiredStep(done, V, V, '2027-01-01.2')).toBe('financial-consent');
  });
});

describe('onboarding gate: route blocking', () => {
  it('opens the guest overview while protecting nested demo and app routes', () => {
    expect(gateDecision('/demo', null, V, V, FC)).toEqual({ action: 'next' });
    expect(gateDecision('/demo/dashboard', null, V, V, FC)).toEqual({ action: 'redirect', to: '/signup' });
    expect(gateDecision('/api/demo/brain', null, V, V, FC)).toMatchObject({ action: 'deny', status: 401 });
  });
  it('keeps the public home accessible and requires sign-up on private routes', () => {
    expect(gateDecision('/', null, V, V, FC)).toEqual({ action: 'next' });
    expect(gateDecision('/feedback', null, V, V, FC)).toEqual({ action: 'redirect', to: '/signup' });
    expect(gateDecision('/api/status', null, V, V, FC)).toMatchObject({ action: 'deny', status: 401 });
    expect(gateDecision('/onboarding/terms', null, V, V, FC)).toEqual({ action: 'redirect', to: '/signup' });
  });
  it('public routes stay reachable', () => {
    for (const p of ['/signup', '/api/auth/signup', '/api/health', '/_next/static/x.js']) expect(gateDecision(p, null, V, V, FC)).toEqual({ action: 'next' });
  });
  it('every app page and API is blocked until all onboarding steps are complete', () => {
    for (const s of [sess(), sess({ tv: V }), sess({ tv: V, rv: V }), sess({ tv: V, rv: V, fc: FC })]) {
      for (const p of ['/', '/feedback']) expect(gateDecision(p, s, V, V, FC).action).toBe('redirect');
      for (const p of ['/api/status', '/api/brain', '/api/kill-switch', '/api/feedback', '/api/account', '/api/engine/scan']) expect(gateDecision(p, s, V, V, FC)).toMatchObject({ action: 'deny', status: 403 });
    }
    expect(gateDecision('/', done, V, V, FC)).toEqual({ action: 'next' });
    expect(gateDecision('/api/status', done, V, V, FC)).toEqual({ action: 'next' });
  });
  it('steps cannot be skipped', () => {
    expect(gateDecision('/onboarding/terms', sess({ av: null }), V, V, FC)).toEqual({ action: 'redirect', to: '/onboarding/age' });
    expect(gateDecision('/api/onboarding/terms', sess({ av: null }), V, V, FC)).toMatchObject({ action: 'deny', status: 403 });
    expect(gateDecision('/api/onboarding/age', sess({ av: null }), V, V, FC)).toEqual({ action: 'next' });
    expect(gateDecision('/onboarding/risk', sess(), V, V, FC)).toEqual({ action: 'redirect', to: '/onboarding/terms' });
    expect(gateDecision('/onboarding/financial-consent', sess({ tv: V }), V, V, FC)).toEqual({ action: 'redirect', to: '/onboarding/risk' });
    expect(gateDecision('/onboarding/wallet', sess({ tv: V, rv: V }), V, V, FC)).toEqual({ action: 'redirect', to: '/onboarding/financial-consent' });
    expect(gateDecision('/api/onboarding/financial-consent', sess({ tv: V, rv: V }), V, V, FC)).toEqual({ action: 'next' });
    expect(gateDecision('/api/onboarding/wallet', sess({ tv: V, rv: V }), V, V, FC)).toMatchObject({ action: 'deny', status: 403 });
    expect(gateDecision('/api/onboarding/terms', sess(), V, V, FC)).toEqual({ action: 'next' });
    expect(gateDecision('/onboarding/wallet', sess({ tv: V, rv: V, fc: FC }), V, V, FC)).toEqual({ action: 'next' });
  });
});

describe('session cookie', () => {
  const secret = 'x'.repeat(40);
  it('round-trips and rejects tampering or the wrong secret', async () => {
    const t = await signSession({ uid: 'u1', email: 'a@b.co', adm: false, av: AGE_ATTESTATION_VERSION, tv: V, rv: V, fc: FC, w: true }, secret);
    expect((await verifySession(t, secret))?.uid).toBe('u1');
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 'u1', av: AGE_ATTESTATION_VERSION, tv: V, rv: V, fc: FC, w: true, exp: 9e9 })).toString('base64url');
    expect(await verifySession(`${forged}.${sig}`, secret)).toBeNull();
    expect(await verifySession(`${body}.${sig}`, 'y'.repeat(40))).toBeNull();
    expect(await verifySession('garbage', secret)).toBeNull();
  });
  it('rejects expired sessions', async () => {
    const t = await signSession({ uid: 'u1', email: 'a@b.co', adm: false, av: AGE_ATTESTATION_VERSION, tv: V, rv: V, fc: FC, w: true }, secret, -10);
    expect(await verifySession(t, secret)).toBeNull();
  });
});

describe('onboarding API validation', () => {
  it('age eligibility requires current version, 18+ and legal permission confirmations', () => {
    expect(validateAgeAttestation({ version: AGE_ATTESTATION_VERSION, confirmed18Plus: true, legallyPermitted: true }, AGE_ATTESTATION_VERSION).ok).toBe(true);
    expect(validateAgeAttestation({ version: AGE_ATTESTATION_VERSION, confirmed18Plus: false, legallyPermitted: true }, AGE_ATTESTATION_VERSION).ok).toBe(false);
    expect(validateAgeAttestation({ version: AGE_ATTESTATION_VERSION, confirmed18Plus: true, legallyPermitted: false }, AGE_ATTESTATION_VERSION).ok).toBe(false);
    expect(validateAgeAttestation({ version: 'old', confirmed18Plus: true, legallyPermitted: true }, AGE_ATTESTATION_VERSION).ok).toBe(false);
  });
  it('terms require current version, scroll-to-end and the read checkbox', () => {
    expect(validateTermsAcceptance({ version: V, scrolledToEnd: true, readConfirmed: true }, V).ok).toBe(true);
    expect(validateTermsAcceptance({ version: V, scrolledToEnd: true, readConfirmed: true }, V, null, AGE_ATTESTATION_VERSION).ok).toBe(false);
    expect(validateTermsAcceptance({ version: V, scrolledToEnd: false, readConfirmed: true }, V).ok).toBe(false);
    expect(validateTermsAcceptance({ version: 'old', scrolledToEnd: true, readConfirmed: true }, V).ok).toBe(false);
  });
  it('risk acknowledgement requires accepted current terms', () => {
    expect(validateRiskAck({ version: V, acknowledged: true }, V, V).ok).toBe(true);
    expect(validateRiskAck({ version: V, acknowledged: true }, V, V, null, AGE_ATTESTATION_VERSION).ok).toBe(false);
    expect(validateRiskAck({ version: V, acknowledged: true }, V, null).ok).toBe(false);
    expect(validateRiskAck({ version: V, acknowledged: false }, V, V).ok).toBe(false);
  });
  it('five financial stages require the right answer and explicit confirmation in order', () => {
    const first = FINANCIAL_CONSENT_STAGES[0];
    for (const stage of FINANCIAL_CONSENT_STAGES) {
      expect(validateFinancialConsentStage({ version: FC, stage: stage.id, answer: stage.correctValue, confirmed: true }, FC, stage.id).ok).toBe(true);
    }
    expect(validateFinancialConsentStage({ version: FC, stage: first.id, answer: first.correctValue, confirmed: true }, FC, first.id).ok).toBe(true);
    expect(validateFinancialConsentStage({ version: FC, stage: first.id, answer: 'principal-protected', confirmed: true }, FC, first.id).ok).toBe(false);
    expect(validateFinancialConsentStage({ version: FC, stage: first.id, answer: first.correctValue, confirmed: false }, FC, first.id).ok).toBe(false);
    expect(validateFinancialConsentStage({ version: FC, stage: FINANCIAL_CONSENT_STAGES[1].id, answer: FINANCIAL_CONSENT_STAGES[1].correctValue, confirmed: true }, FC, first.id).ok).toBe(false);
    expect(validateFinancialConsentStage({ version: 'old', stage: first.id, answer: first.correctValue, confirmed: true }, FC, first.id).ok).toBe(false);
    expect(validateFinancialConsentStage({ version: FC, stage: first.id, answer: first.correctValue, confirmed: true }, FC, null).ok).toBe(false);
  });
  it('wallet setup is blocked until terms, risk and financial understanding are complete', () => {
    const pk = Keypair.generate().publicKey.toBase58();
    expect(validateWalletSetup({ source: 'paper' }, true, true, true, true).ok).toBe(true);
    expect(validateWalletSetup({ source: 'paper' }, true, true, true, false).ok).toBe(false);
    expect(validateWalletSetup({ source: 'paper' }, true, true, false, true).ok).toBe(false);
    expect(validateWalletSetup({ source: 'paper' }, true, false, true, true).ok).toBe(false);
    expect(validateWalletSetup({ publicKey: pk, source: 'connected', signature: 'sig', message: 'msg', challenge: 'tok' }, true, true, true, true).ok).toBe(true);
    expect(validateWalletSetup({ publicKey: pk, source: 'connected' }, true, true, true, true).ok).toBe(false);
    expect(validateWalletSetup({ publicKey: 'not-a-key', source: 'connected', signature: 's', message: 'm', challenge: 'c' }, true, true, true, true).ok).toBe(false);
    expect(validateWalletSetup({ publicKey: pk, source: 'created' }, true, true, true, true).ok).toBe(false);
    expect(validateWalletSetup({ publicKey: pk, source: 'imported' }, true, true, true, true).ok).toBe(false);
    expect(validateWalletSetup({ publicKey: pk, source: 'connected', signature: 's', message: 'm', challenge: 'c', mnemonic: 'abandon ...' }, true, true, true, true).ok).toBe(false);
  });
  it('wallet challenge sub-route is allowed only after financial consent', () => {
    expect(gateDecision('/api/onboarding/wallet/challenge', sess({ tv: V, rv: V, fc: FC }), V, V, FC)).toEqual({ action: 'next' });
    expect(gateDecision('/api/onboarding/wallet/challenge', sess({ tv: V, rv: V }), V, V, FC)).toMatchObject({ action: 'deny', status: 403 });
  });
});

it('routes only the exact paper cron endpoint to its bearer-secret check', () => {
  expect(gateDecision('/api/cron/paper-engine', null, V, V, FC)).toEqual({ action: 'next' });
  expect(gateDecision('/api/cron/paper-engine/extra', null, V, V, FC)).toMatchObject({ action: 'deny', status: 401 });
});
