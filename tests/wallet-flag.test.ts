import { describe, expect, it } from 'vitest';
import { walletConnectEnabled } from '@/lib/wallet-flag';

describe('wallet connect flag', () => {
  it('is off by default', () => {
    expect(walletConnectEnabled({})).toBe(false);
    expect(walletConnectEnabled({ NEXT_PUBLIC_WALLET_CONNECT_ENABLED: '' })).toBe(false);
    expect(walletConnectEnabled({ NEXT_PUBLIC_WALLET_CONNECT_ENABLED: '0' })).toBe(false);
    expect(walletConnectEnabled({ NEXT_PUBLIC_WALLET_CONNECT_ENABLED: 'yes' })).toBe(false);
  });
  it('turns on only with 1 or true', () => {
    expect(walletConnectEnabled({ NEXT_PUBLIC_WALLET_CONNECT_ENABLED: '1' })).toBe(true);
    expect(walletConnectEnabled({ NEXT_PUBLIC_WALLET_CONNECT_ENABLED: 'TRUE' })).toBe(true);
  });
});
