import { describe, it, expect, beforeEach } from 'vitest';
import { rugcheckConfig, rugcheckGet, resetRugcheckState, rugcheckStatus, RUGCHECK_PUBLIC_BASE } from '../src/lib/rugcheck';

const resp = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('rugcheck config', () => {
  it('defaults to the public v1 base', () => {
    expect(rugcheckConfig({}).baseUrl).toBe(RUGCHECK_PUBLIC_BASE);
  });
  it('strips ?key= from the URL, uses it as the key if unset, and adds /v1', () => {
    const c = rugcheckConfig({ RUGCHECK_API_URL: 'https://api.rugcheck.xyz?key=abc' });
    expect(c.baseUrl).toBe('https://api.rugcheck.xyz/v1');
    expect(c.apiKey).toBe('abc');
    expect(rugcheckConfig({ RUGCHECK_API_URL: 'https://x.test/v1/?key=abc', RUGCHECK_API_KEY: 'k' }).apiKey).toBe('k');
    expect(rugcheckConfig({ RUGCHECK_API_URL: 'https://x.test/v1/' }).baseUrl).toBe('https://x.test/v1');
  });
});

describe('rugcheckGet auth fallback', () => {
  beforeEach(() => resetRugcheckState());
  const cfg = { baseUrl: 'https://x.test/v1', apiKey: 'K', shieldKey: 'S' };

  it('sends X-API-KEY first', async () => {
    const seen: { url: string; key?: string }[] = [];
    const f = (async (url: string, init: RequestInit) => { seen.push({ url, key: (init.headers as Record<string, string>)['X-API-KEY'] }); return resp(200, { score: 1 }); }) as unknown as typeof fetch;
    expect(await rugcheckGet('/tokens/m/report', { cfg, fetchImpl: f })).toEqual({ score: 1 });
    expect(seen).toEqual([{ url: 'https://x.test/v1/tokens/m/report', key: 'K' }]);
    expect(rugcheckStatus(cfg).lastMode).toBe('api_key');
  });

  it('falls back key → shield → public on 401, and skips rejected keys afterwards', async () => {
    const seen: string[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const k = (init.headers as Record<string, string>)['X-API-KEY'];
      seen.push(k ?? 'public:' + url);
      return k ? resp(401, { error: 'invalid api key' }) : resp(200, { ok: 1 });
    }) as unknown as typeof fetch;
    expect(await rugcheckGet('/p', { cfg, fetchImpl: f })).toEqual({ ok: 1 });
    expect(seen).toEqual(['K', 'S', `public:${RUGCHECK_PUBLIC_BASE}/p`]);
    seen.length = 0;
    await rugcheckGet('/p', { cfg, fetchImpl: f });
    expect(seen).toEqual([`public:${RUGCHECK_PUBLIC_BASE}/p`]);
    const s = rugcheckStatus(cfg);
    expect(s.apiKeyRejected).toBe(true);
    expect(s.lastMode).toBe('public');
    expect(JSON.stringify(s)).not.toContain('"K"');
  });

  it('falls back to public on network errors, and returns null on 404', async () => {
    let n = 0;
    const f = (async () => { n++; if (n === 1) throw new Error('timeout'); return resp(200, { a: 1 }); }) as unknown as typeof fetch;
    expect(await rugcheckGet('/p', { cfg: { ...cfg, shieldKey: null }, fetchImpl: f })).toEqual({ a: 1 });
    resetRugcheckState();
    const f404 = (async () => resp(404)) as unknown as typeof fetch;
    expect(await rugcheckGet('/p', { cfg, fetchImpl: f404 })).toBeNull();
  });
});
