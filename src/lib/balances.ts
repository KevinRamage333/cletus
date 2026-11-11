import { rpcCall } from './rpc-pool';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const cache = new Map<string, { at: number; v: { sol: number | null; usdc: number | null; error: string | null } }>();
/** Live SOL + USDC balance for a public address (cached 15s). */
export async function walletBalances(address: string) {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < 15_000) return hit.v;
  try {
    const [b, t] = await Promise.all([
      rpcCall<{ value: number }>('getBalance', [address]),
      rpcCall<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number } } } } } }[] }>('getTokenAccountsByOwner', [address, { mint: USDC_MINT }, { encoding: 'jsonParsed' }]),
    ]);
    const v = { sol: b.value / 1e9, usdc: t.value.reduce((s, x) => s + (x.account.data.parsed.info.tokenAmount.uiAmount || 0), 0), error: null };
    cache.set(address, { at: Date.now(), v });
    return v;
  } catch (e) {
    return { sol: null, usdc: null, error: String((e as Error).message).replace(/https?:\/\/\S+/g, '[url]').slice(0, 80) };
  }
}
