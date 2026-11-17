import { agentCan } from './registry';

const WORKER_STALE_MS = 3 * 60_000;
const SCAN_STALE_MS = 5 * 60_000;

type Status = 'healthy' | 'degraded' | 'unavailable' | 'inactive';
type Check = { status: Status; observedAt?: string; detail: string };

export function assessOperations(input: {
  now: Date;
  demo: boolean;
  engineDisabled: boolean;
  cron: boolean;
  mode: 'simulation' | 'live';
  databaseOk: boolean;
  heartbeatAt?: Date | null;
  completedMonitorAt?: Date | null;
  scanAt?: Date | null;
  scanError?: boolean;
}) {
  const inactive = input.demo || input.engineDisabled;
  const fresh = (at: Date, limit: number) => {
    const age = input.now.getTime() - at.getTime();
    return age >= 0 && age <= limit;
  };
  const inactiveWorker: Check = {
    status: 'inactive',
    detail: input.demo ? 'Public demo mode disables the scheduled paper worker.'
      : input.engineDisabled ? 'The engine is disabled.'
      : input.mode !== 'simulation' ? 'The scheduled paper worker requires simulation mode.'
      : 'This deployment uses a different engine transport.',
  };
  let worker: Check = inactiveWorker;
  if (!inactive && input.cron && input.mode === 'simulation') {
    if (!input.databaseOk || !input.heartbeatAt) {
      worker = { status: 'unavailable', detail: 'No scheduled-worker heartbeat is available.' };
    } else if (!fresh(input.heartbeatAt, WORKER_STALE_MS) ||
      !input.completedMonitorAt || !fresh(input.completedMonitorAt, WORKER_STALE_MS) ||
      input.completedMonitorAt < input.heartbeatAt) {
      worker = { status: 'degraded', observedAt: input.heartbeatAt.toISOString(), detail: 'The heartbeat or latest completed position check is stale or incomplete.' };
    } else {
      worker = { status: 'healthy', observedAt: input.heartbeatAt.toISOString(), detail: 'The latest heartbeat includes a completed position check.' };
    }
  }

  let scanner: Check;
  if (inactive) {
    scanner = { status: 'inactive', detail: 'Scanning is disabled on this deployment.' };
  } else if (!input.databaseOk || !input.scanAt) {
    scanner = { status: 'unavailable', detail: 'No persisted scan is available.' };
  } else {
    const healthy = !input.scanError && fresh(input.scanAt, SCAN_STALE_MS);
    scanner = {
      status: healthy ? 'healthy' : 'degraded', observedAt: input.scanAt.toISOString(),
      detail: healthy ? 'A recent scan is recorded.' : 'The last recorded scan is stale or the engine reports a scan error.',
    };
  }
  const database: Check = {
    status: input.demo ? 'inactive' : input.databaseOk ? 'healthy' : 'unavailable',
    detail: input.demo ? 'The public demo skips the app database.' : input.databaseOk ? 'The app database returned the health records.' : 'The app database health query failed.',
  };
  return { agent: 'operations', checkedAt: input.now.toISOString(), database, worker, scanner };
}

export async function getOperationsReport(config: { mode: 'simulation' | 'live' }) {
  if (!agentCan('operations', 'read:service-health')) throw new Error('Operations health access is disabled');
  const { isDemo } = await import('../demo');
  const input = {
    now: new Date(), mode: config.mode, demo: isDemo(), databaseOk: false,
    engineDisabled: process.env.ENGINE_DISABLED === 'true',
    cron: process.env.CLETUS_ENGINE_TRANSPORT === 'cron',
  };
  if (input.demo) return assessOperations(input);

  try {
    const { prisma } = await import('../db');
    const [state, heartbeat, completed] = await Promise.all([
      prisma.engineState.findUnique({ where: { id: 'global' }, select: { lastScanAt: true, lastError: true } }),
      prisma.logEntry.findFirst({ where: { accountId: null, message: { startsWith: 'PAPER_WORKER_HEARTBEAT' } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.logEntry.findFirst({ where: { accountId: null, message: 'PAPER_WORKER_HEARTBEAT monitor=completed' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    return assessOperations({
      ...input, now: new Date(), databaseOk: true, scanAt: state?.lastScanAt, scanError: Boolean(state?.lastError),
      heartbeatAt: heartbeat?.createdAt, completedMonitorAt: completed?.createdAt,
    });
  } catch {
    return assessOperations({ ...input, now: new Date() });
  }
}
