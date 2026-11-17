import { expect, it } from 'vitest';
import { geckoNetworkFor, selectEvmMarket } from '@/lib/evm-market';

const address = '0x' + 'a'.repeat(40);
const other = '0x' + 'b'.repeat(40);
const pool = '0x' + 'c'.repeat(40);
const market = { chainId: 'base', pairAddress: pool, baseToken: { address }, quoteToken: { address: other }, priceUsd: '2.5', liquidity: { usd: 100 } };

it('keeps price attribution on the matched base token and rejects mismatched pool or chain', () => {
  expect(selectEvmMarket([market], 'base', address.toUpperCase(), 'token')).toMatchObject({ mint: address, priceUsd: 2.5 });
  expect(selectEvmMarket([market], 'base', other, 'token')).toBeNull();
  expect(selectEvmMarket([market], 'ethereum', address, 'token')).toBeNull();
  expect(selectEvmMarket([market], 'base', address, 'pool')).toBeNull();
  expect(selectEvmMarket([market], 'base', pool, 'pool')).toMatchObject({ pool, mint: address });
});

it('ranks valid priced pairs by liquidity and preserves missing prices in pool lookups', () => {
  const unpriced = { ...market, priceUsd: '', liquidity: { usd: 1000 } };
  const deep = { ...market, priceUsd: '3', liquidity: { usd: 200 } };
  expect(selectEvmMarket([unpriced, market, deep], 'base', address, 'token')?.priceUsd).toBe(3);
  expect(selectEvmMarket([unpriced], 'base', pool, 'pool')?.priceUsd).toBeNull();
  expect(geckoNetworkFor('optimism')).toBe('optimism');
  expect(geckoNetworkFor('constructor')).toBeNull();
});
