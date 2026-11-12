import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchKolCallouts, kolConfig, kolStatus, _resetKolPoll } from '@/lib/kol-mode';

describe('KOL X API 402 backoff', () => {
  afterEach(() => { vi.unstubAllGlobals(); _resetKolPoll(); });
  it('backs off 10 minutes on 402 and retries after, so topped-up credits are picked up', async () => {
    _resetKolPoll();
    const cfg = { ...kolConfig({ KOL_MODE: 'on' }), callFile: '/nonexistent/kol.json' };
    const f = vi.fn(async () => new Response('{"title":"Payment Required"}', { status: 402 }));
    vi.stubGlobal('fetch', f);
    const t0 = Date.parse('2026-11-12T13:00:00Z');
    await fetchKolCallouts(cfg, t0, { X_BEARER_TOKEN: 'x' });
    expect(kolStatus().lastError).toContain('402');
    expect(kolStatus().backoffUntil).toBe(t0 + 600_000);
    const n = f.mock.calls.length;
    await fetchKolCallouts(cfg, t0 + 5 * 60_000, { X_BEARER_TOKEN: 'x' });
    expect(f.mock.calls.length).toBe(n);
    f.mockImplementation(async () => new Response('{"data":[]}', { status: 200 }));
    await fetchKolCallouts(cfg, t0 + 11 * 60_000, { X_BEARER_TOKEN: 'x' });
    expect(f.mock.calls.length).toBeGreaterThan(n);
    expect(kolStatus().lastError).toBeNull();
  });
});
