import { afterEach, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { getOperatorPublicKey, loadTradingKeypair, resetTradingKeypairCache } from '@/lib/wallet';

const prevKey = process.env.TRADING_WALLET_PRIVATE_KEY;
const prevPath = process.env.TRADING_WALLET_KEYPAIR_PATH;

afterEach(() => {
  resetTradingKeypairCache();
  if (prevKey === undefined) delete process.env.TRADING_WALLET_PRIVATE_KEY;
  else process.env.TRADING_WALLET_PRIVATE_KEY = prevKey;
  if (prevPath === undefined) delete process.env.TRADING_WALLET_KEYPAIR_PATH;
  else process.env.TRADING_WALLET_KEYPAIR_PATH = prevPath;
});

describe('loadTradingKeypair', () => {
  it('signs a message that verifies after the source secret buffer is cleared', () => {
    const generated = Keypair.generate();
    const expected = generated.publicKey.toBase58();
    const source = Uint8Array.from(generated.secretKey);
    process.env.TRADING_WALLET_PRIVATE_KEY = JSON.stringify(Array.from(source));
    delete process.env.TRADING_WALLET_KEYPAIR_PATH;
    resetTradingKeypairCache();

    const kp = loadTradingKeypair();
    source.fill(0);

    expect(kp.publicKey.toBase58()).toBe(expected);
    expect(getOperatorPublicKey()).toBe(expected);
    expect(kp.secretKey.some((b) => b !== 0)).toBe(true);

    const message = new TextEncoder().encode('cletus-wallet-verify');
    const signature = nacl.sign.detached(message, kp.secretKey);
    expect(nacl.sign.detached.verify(message, signature, kp.publicKey.toBytes())).toBe(true);
  });
});
