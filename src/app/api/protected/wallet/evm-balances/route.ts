import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, requireOnboardedUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const NETWORKS = [
  { key: 'ethereum', name: 'Ethereum', symbol: 'ETH', chainId: '0x1', alchemy: 'eth-mainnet' },
  { key: 'base', name: 'Base', symbol: 'ETH', chainId: '0x2105', alchemy: 'base-mainnet' },
  { key: 'arbitrum', name: 'Arbitrum One', symbol: 'ETH', chainId: '0xa4b1', alchemy: 'arb-mainnet' },
  { key: 'polygon', name: 'Polygon PoS', symbol: 'POL', chainId: '0x89', alchemy: 'polygon-mainnet' },
  { key: 'optimism', name: 'Optimism', symbol: 'ETH', chainId: '0xa', alchemy: 'opt-mainnet' },
  { key: 'robinhood', name: 'Robinhood Chain', symbol: 'ETH', chainId: '0x1237', alchemy: 'robinhood-mainnet' },
  { key: 'avalanche', name: 'Avalanche C-Chain', symbol: 'AVAX', chainId: '0xa86a', alchemy: 'avax-mainnet' },
  { key: 'bnb', name: 'BNB Smart Chain', symbol: 'BNB', chainId: '0x38', alchemy: 'bnb-mainnet' },
  { key: 'monad', name: 'Monad', symbol: 'MON', chainId: '0x8f', alchemy: 'monad-mainnet' },
] as const;

function formatNativeBalance(raw: bigint): string {
  const unit = 10n ** 18n;
  const whole = raw / unit;
  const fraction = (raw % unit).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

async function readBalance(rpcUrl: string, address: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
  const payload = await response.json() as { result?: string; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message || 'RPC request failed');
  if (!payload.result || !/^0x[0-9a-f]+$/i.test(payload.result)) throw new Error('RPC returned an invalid balance');
  return formatNativeBalance(BigInt(payload.result));
}

export async function GET(request: NextRequest) {
  try {
    await requireOnboardedUser();
    const address = request.nextUrl.searchParams.get('address') || '';
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'A valid EVM public address is required.' }, { status: 400 });
    }

    const alchemyKey = process.env.ALCHEMY_API_KEY;
    const balances = await Promise.all(NETWORKS.map(async (network) => {
      const overrideName = `EVM_RPC_URL_${network.key.toUpperCase()}`;
      const rpcUrl = process.env[overrideName] || (alchemyKey
        ? `https://${network.alchemy}.g.alchemy.com/v2/${alchemyKey}`
        : null);
      if (!rpcUrl) {
        return { key: network.key, name: network.name, symbol: network.symbol, chainId: network.chainId, balance: null, status: 'not_configured' as const };
      }
      try {
        const balance = await readBalance(rpcUrl, address);
        return { key: network.key, name: network.name, symbol: network.symbol, chainId: network.chainId, balance, status: 'ok' as const };
      } catch (error) {
        return { key: network.key, name: network.name, symbol: network.symbol, chainId: network.chainId, balance: null, status: 'unavailable' as const, error: (error as Error).message };
      }
    }));

    return NextResponse.json({ address, balances, checkedAt: new Date().toISOString(), scope: 'native_coin_only' }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
