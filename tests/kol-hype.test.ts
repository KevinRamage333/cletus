import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBoosts, parsePumpCoins, parseGeckoPools, hitsToCallouts, fetchHypeCallouts, hypeStatus, _resetHype } from '@/lib/kol-hype';
import { fetchKolCallouts, kolConfig, _resetKolPoll } from '@/lib/kol-mode';

const A = 'wbcE7iMmWN1XGEa6mtgRS3FoLgc936rMJYjeujapump';
const B = 'AJFnmpiF4VTKeqEWtwBUarib5zKKbXcs594UyrMHpump';
const C = 'EdEtnuUaTgXAd1izQT4Mt2dJFikN77vdd5xmCJvcpump';
const band = { min: 5_000, max: 25_000 };

describe('KOL hype sources', () => {
  afterEach(() => { _resetHype(); _resetKolPoll(); vi.unstubAllGlobals(); });
  it('parses DexScreener boosts (Solana only), pump.fun coins and GeckoTerminal pump pools', () => {
    expect(parseBoosts([{ chainId: 'solana', tokenAddress: A }, { chainId: 'base', tokenAddress: '0xabc' }], 'boost-top')).toEqual([{ mint: A, source: 'boost-top', mcapUsd: null }]);
    expect(parsePumpCoins({ mint: B, usd_market_cap: 12_000 }, 'pump-koth')).toEqual([{ mint: B, source: 'pump-koth', mcapUsd: 12_000 }]);
    const gecko = { data: [
      { attributes: { market_cap_usd: null, fdv_usd: '9000' }, relationships: { base_token: { data: { id: `solana_${C}` } }, dex: { data: { id: 'pump-fun' } } } },
      { attributes: { fdv_usd: '9000' }, relationships: { base_token: { data: { id: `solana_${A}` } }, dex: { data: { id: 'raydium' } } } },
    ] };
    expect(parseGeckoPools(gecko)).toEqual([{ mint: C, source: 'gecko-pump', mcapUsd: 9000 }]);
  });
  it('merges by mint, ranks multi-source first, drops far-out-of-band caps', () => {
    const out = hitsToCallouts([
      { mint: A, source: 'boost-latest', mcapUsd: null }, { mint: B, source: 'pump-live', mcapUsd: 12_000 },
      { mint: B, source: 'gecko-pump', mcapUsd: 12_000 }, { mint: C, source: 'gecko-pump', mcapUsd: 5_000_000 },
    ], band, 1);
    expect(out.map((x) => x.mint)).toEqual([B, A]);
    expect(out[0].handle).toBe('hype:pump-live+gecko-pump');
  });
  it('tolerates a blocked pump.fun and caches between polls', async () => {
    const getJson = vi.fn(async (url: string) => {
      if (url.includes('pump.fun')) throw new Error('HTTP 403 (Cloudflare block)');
      if (url.includes('token-boosts')) return [{ chainId: 'solana', tokenAddress: A }];
      return { data: [] };
    });
    const deps = { getJson, phantom: async () => [B] };
    const r = await fetchHypeCallouts(band, 1_000_000, {}, deps);
    expect(r.map((x) => x.mint).sort()).toEqual([A, B].sort());
    expect(hypeStatus().errors['pump-koth']).toContain('403');
    const n = getJson.mock.calls.length;
    await fetchHypeCallouts(band, 1_000_000 + 60_000, {}, deps);
    expect(getJson.mock.calls.length).toBe(n);
  });
  it('default KOL source is hype: no X API calls even with a bearer token', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 402 }));
    vi.stubGlobal('fetch', f);
    const cfg = { ...kolConfig({ KOL_MODE: 'on' }), callFile: '/nonexistent.json' };
    expect(cfg.source).toBe('hype');
    await fetchKolCallouts(cfg, Date.now(), { X_BEARER_TOKEN: 'x' });
    expect(f).not.toHaveBeenCalled();
  });
});
