import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import {
  SIWS_STATEMENT, buildSiwsMessage, parseSiwsMessage, verifySiwsSignature,
  issueSiwsChallenge, verifySiwsResponse, allowedSiwsHost, decodeSignature,
} from '@/lib/siws';

const secret = 'test-siws-secret-which-is-at-least-32-chars!!';

describe('SIWS message', () => {
  const fields = {
    domain: 'cletus-autonomous-trader.vercel.app',
    address: Keypair.generate().publicKey.toBase58(),
    statement: SIWS_STATEMENT,
    uri: 'https://cletus-autonomous-trader.vercel.app/onboarding/wallet',
    version: '1',
    chainId: 'mainnet',
    nonce: 'abc123',
    issuedAt: '2026-11-11T17:00:00.000Z',
    expirationTime: '2026-11-11T17:05:00.000Z',
  };
  it('round-trips fields and states that the signature is auth-only', () => {
    const msg = buildSiwsMessage(fields);
    expect(msg).toContain('wants you to sign in with your Solana account');
    expect(msg).toContain('is not a transaction');
    expect(msg).not.toMatch(/delegat|session key|approve all|unlimited/i);
    expect(parseSiwsMessage(msg)).toEqual(fields);
    expect(parseSiwsMessage('not a siws message')).toBeNull();
  });
});

describe('SIWS signatures and challenges', () => {
  it('accepts a valid message signature and rejects a wrong key, message, or expired challenge', async () => {
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const issued = await issueSiwsChallenge({
      uid: 'user-1', address,
      domain: 'localhost', uri: 'http://localhost:3000/onboarding/wallet',
      secret, ttlSec: 300, now: new Date('2026-11-11T17:00:00.000Z'),
    });
    const sig = nacl.sign.detached(new TextEncoder().encode(issued.message), kp.secretKey);
    expect(verifySiwsSignature(issued.message, sig, address)).toBe(true);
    expect(verifySiwsSignature(issued.message, bs58.encode(sig), address)).toBe(true);
    expect(verifySiwsSignature(issued.message, Buffer.from(sig).toString('base64'), address)).toBe(true);
    expect(verifySiwsSignature(issued.message + 'x', sig, address)).toBe(false);
    expect(verifySiwsSignature(issued.message, sig, Keypair.generate().publicKey.toBase58())).toBe(false);

    const now = Date.parse('2026-11-11T17:01:00.000Z');
    expect(await verifySiwsResponse({
      message: issued.message, signature: bs58.encode(sig), challenge: issued.challenge,
      address, uid: 'user-1', secret, now,
    })).toBeNull();
    expect(await verifySiwsResponse({
      message: issued.message, signature: bs58.encode(sig), challenge: issued.challenge,
      address, uid: 'someone-else', secret, now,
    })).toMatch(/different session/);
    expect(await verifySiwsResponse({
      message: issued.message, signature: bs58.encode(sig), challenge: 'tampered.token',
      address, uid: 'user-1', secret, now,
    })).toMatch(/invalid or expired/);
    expect(await verifySiwsResponse({
      message: issued.message, signature: bs58.encode(sig), challenge: issued.challenge,
      address, uid: 'user-1', secret, now: Date.parse('2026-11-11T18:00:00.000Z'),
    })).toMatch(/expired/);
  });
  it('decodeSignature rejects short or junk values', () => {
    expect(decodeSignature('nope')).toBeNull();
    expect(decodeSignature(new Uint8Array(32))).toBeNull();
  });
});

describe('SIWS host allowlist', () => {
  it('allows production, localhost and this project\'s Vercel hosts', () => {
    expect(allowedSiwsHost('localhost')).toBe(true);
    expect(allowedSiwsHost('cletus-autonomous-trader.vercel.app')).toBe(true);
    expect(allowedSiwsHost('cletus-autonomous-trader-abc123-cletus1.vercel.app')).toBe(true);
    expect(allowedSiwsHost('cletusai.xyz')).toBe(true);
    expect(allowedSiwsHost('evil.example.com')).toBe(false);
    expect(allowedSiwsHost('not-our-app.vercel.app')).toBe(false);
  });
});
