import { describe, it, expect } from 'vitest';
import { newPool, recordResult, configuredEndpoints, DEFAULT_POOL_PARAMS as P } from '@/lib/rpc-pool';

describe('RPC failover (Helius primary, FluxRPC backup)', () => {
  it('builds endpoints in priority order without exposing extra ones', () => {
    const e = configuredEndpoints({ HELIUS_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x', BACKUP_RPC_URL: 'https://us.fluxrpc.com?key=y' });
    expect(e.map((x) => x.name)).toEqual(['helius', 'fluxrpc']);
    expect(configuredEndpoints({}).map((x) => x.name)).toEqual(['public']);
  });
  it('switches to the backup after consecutive errors/timeouts', () => {
    let s = newPool(['helius', 'fluxrpc']);
    s = recordResult(s, 0, { ok: false, latencyMs: 8000, error: 'timeout' }, P);
    expect(s.active).toBe(0);
    s = recordResult(s, 0, { ok: false, latencyMs: 8000, error: 'timeout' }, P);
    expect(s.active).toBe(1);
    expect(s.lastSwitchReason).toMatch(/helius failed 2x \(timeout\)/);
  });
  it('switches on sustained high latency', () => {
    let s = newPool(['helius', 'fluxrpc']);
    for (let i = 0; i < 6; i++) s = recordResult(s, 0, { ok: true, latencyMs: 4000 }, P);
    expect(s.active).toBe(1);
    expect(s.lastSwitchReason).toMatch(/latency/);
  });
  it('does not switch to an unhealthy backup', () => {
    let s = newPool(['helius', 'fluxrpc']);
    s = recordResult(s, 1, { ok: false, latencyMs: 1, error: 'x' }, P);
    s = recordResult(s, 1, { ok: false, latencyMs: 1, error: 'x' }, P);
    s = recordResult(s, 0, { ok: false, latencyMs: 1, error: 'y' }, P);
    s = recordResult(s, 0, { ok: false, latencyMs: 1, error: 'y' }, P);
    expect(s.active).toBe(0);
  });
  it('switches back after the primary passes N health checks', () => {
    let s = newPool(['helius', 'fluxrpc']);
    s = recordResult(s, 0, { ok: false, latencyMs: 1, error: 'down' }, P);
    s = recordResult(s, 0, { ok: false, latencyMs: 1, error: 'down' }, P);
    expect(s.active).toBe(1);
    s = recordResult(s, 0, { ok: true, latencyMs: 100 }, P); // a normal call alone doesn't count
    expect(s.active).toBe(1);
    for (let i = 0; i < P.recoverChecks - 1; i++) s = recordResult(s, 0, { ok: true, latencyMs: 100, isHealthCheck: true }, P);
    expect(s.active).toBe(1);
    s = recordResult(s, 0, { ok: true, latencyMs: 100, isHealthCheck: true }, P);
    expect(s.active).toBe(0);
    expect(s.lastSwitchReason).toBe('helius recovered');
    expect(s.switches).toBe(2);
  });
});
