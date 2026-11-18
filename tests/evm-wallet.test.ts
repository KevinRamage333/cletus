import { describe, it, expect } from 'vitest';
import { dedupeEvmConnectors, evmConnectorDedupeKey } from '@/lib/evm-wallet';

describe('EIP-6963 wallet dedupe', () => {
  it('dedupes by rdns/id, not by display name', () => {
    const list = dedupeEvmConnectors([
      { id: 'io.metamask', name: 'MetaMask', type: 'injected', rdns: 'io.metamask' },
      { id: 'app.phantom', name: 'MetaMask', type: 'injected', rdns: 'app.phantom' },
      { id: 'io.metamask', name: 'MetaMask (dup)', type: 'injected', rdns: 'io.metamask' },
      { id: 'injected', name: 'Injected', type: 'injected' },
    ]);
    expect(list.map((c) => evmConnectorDedupeKey(c))).toEqual(['io.metamask', 'app.phantom']);
  });
  it('falls back to id when rdns is missing', () => {
    const list = dedupeEvmConnectors([
      { id: 'metaMask', name: 'MetaMask', type: 'injected' },
      { id: 'coinbaseWallet', name: 'Coinbase Wallet', type: 'injected' },
      { id: 'metaMask', name: 'MetaMask', type: 'injected' },
    ]);
    expect(list.map((c) => c.id)).toEqual(['metaMask', 'coinbaseWallet']);
  });
});
