import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { GET } from '@/app/api/cron/paper-engine/route';

const engine = vi.hoisted(() => ({
  ensureOperatorAccount: vi.fn(),
  monitorDeadlineMs: () => 10_000,
  scanDeadlineMs: () => 10_000,
  monitorTick: vi.fn(),
  scanTick: vi.fn(),
}));
vi.mock('@/lib/engine', () => engine);
vi.mock('@/lib/config', () => ({ getConfig: () => ({ mode: 'simulation' }) }));

const enabled = process.env.PAPER_SETTLEMENT_PG_TEST === '1';

function request() {
  return new Request('http://localhost/api/cron/paper-engine', {
    headers: { authorization: 'Bearer ci-paper-worker' },
  });
}

describe.skipIf(!enabled)('scheduled paper worker with PostgreSQL', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'ci-paper-worker');
    vi.stubEnv('CLETUS_ENGINE_TRANSPORT', 'cron');
    vi.stubEnv('CLETUS_DEMO', 'false');
    vi.stubEnv('ENGINE_DISABLED', 'false');
    vi.resetAllMocks();
    engine.monitorTick.mockResolvedValue(true);
    engine.scanTick.mockResolvedValue('test scan completed');
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => prisma.$disconnect());

  it('skips an overlapping invocation and persists the completed position-check heartbeat', async () => {
    let releaseMonitor!: (completed: boolean) => void;
    let monitorEntered!: () => void;
    const entered = new Promise<void>((resolve) => { monitorEntered = resolve; });
    engine.monitorTick.mockImplementationOnce(() => {
      monitorEntered();
      return new Promise<boolean>((resolve) => { releaseMonitor = resolve; });
    });
    const first = GET(request());
    try {
      await Promise.race([
        entered,
        first.then(async (response) => { throw new Error(`Worker exited before monitoring (HTTP ${response.status})`); }),
      ]);
      const overlapping = await GET(request());
      expect(overlapping.status).toBe(200);
      expect(await overlapping.json()).toMatchObject({ ok: true, skipped: true });
      expect(engine.monitorTick).toHaveBeenCalledTimes(1);
    } finally {
      releaseMonitor?.(true);
      await first;
    }
    const response = await first;
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ ok: true, skipped: false, mode: 'simulation', scanSummary: 'test scan completed' });
    expect(engine.scanTick).toHaveBeenCalledTimes(1);
    expect(result.monitoredAt).toEqual(expect.any(String));
    expect(await prisma.logEntry.count({
      where: {
        accountId: null, createdAt: new Date(result.heartbeatAt),
        message: 'PAPER_WORKER_HEARTBEAT monitor=completed',
      },
    })).toBe(1);
  }, 20_000);

  it('persists an incomplete heartbeat and skips scanning when position checks time out', async () => {
    engine.monitorTick.mockResolvedValueOnce(false);
    const response = await GET(request());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ ok: true, skipped: false, monitoredAt: null });
    expect(engine.scanTick).not.toHaveBeenCalled();
    expect(await prisma.logEntry.count({
      where: {
        accountId: null, createdAt: new Date(result.heartbeatAt),
        message: 'PAPER_WORKER_HEARTBEAT monitor=incomplete',
      },
    })).toBe(1);
  });

  it('leaves the worker disabled on the public demo deployment', async () => {
    vi.stubEnv('CLETUS_DEMO', 'true');
    expect((await GET(request())).status).toBe(409);
    expect(engine.monitorTick).not.toHaveBeenCalled();
  });
});
