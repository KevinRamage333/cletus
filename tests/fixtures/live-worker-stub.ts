/**
 * Test-only stub: takes the live-worker lock and stays alive. Never imports the
 * engine or places trades. Used to simulate start / second-start / hung-restart
 * without touching the production worker.
 */
import { acquireLiveWorkerLockOrExit } from '../../src/lib/worker-lock';

acquireLiveWorkerLockOrExit();
console.log(`[stub] locked pid ${process.pid} lock=${process.env.LIVE_WORKER_LOCK ?? ''}`);
const tick = setInterval(() => undefined, 30_000);
tick.unref?.();
// Keep the process alive for the singleton simulation (the lock helper is unref'd? we don't unref it).
setInterval(() => undefined, 1 << 30);
