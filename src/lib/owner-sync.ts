/**
 * Box-side sync: apply the owner halt flag to the engine kill switch, publish a
 * dashboard snapshot (including the anonymized public live feed) to Vercel, and
 * pull any halt/resume command the owner set from the site.
 *
 * Re-entrancy guarded so setKillSwitch → monitorTick → sync cannot loop.
 */
import { applyHaltCommand, isOwnerHaltReason, markHaltApplied, mergeHalt, type HaltState } from './owner-halt';
import { loadOwnerState, pullOwnerState, pushOwnerState, saveOwnerState } from './owner-store';
import { mergeRequests } from './owner-withdraw-queue';

let running = false;
let lastPush = 0;

export async function syncHaltAndPublishSnapshot(opts?: { forcePush?: boolean }): Promise<void> {
  if (running) return;
  running = true;
  try {
    const local = loadOwnerState();
    const remote = await pullOwnerState().catch(() => null);
    let halt: HaltState = remote ? mergeHalt(local.halt, remote.halt) : local.halt;

    if (!process.env.VERCEL && process.env.CLETUS_DEMO !== '1') {
      try {
        const { getEngineState, setKillSwitch } = await import('./engine');
        const st = await getEngineState();
        if (halt.halted && !st.killSwitch) {
          await setKillSwitch(true, halt.reason ?? 'owner_sell_all:sell all');
          halt = markHaltApplied(halt);
        } else if (!halt.halted && st.killSwitch && isOwnerHaltReason(st.killReason)) {
          await setKillSwitch(false, 'owner resume');
        } else if (st.killSwitch && isOwnerHaltReason(st.killReason) && !halt.halted) {
          // Engine was halted by a previous process; reflect it.
          const applied = applyHaltCommand(halt, { action: 'halt', reason: st.killReason ?? 'sell all', by: 'engine', source: 'engine' });
          halt = applied.state;
        }
      } catch {
        /* engine / db unavailable */
      }
    }

    let snapshot = local.snapshot;
    try {
      const { buildOwnerStatus } = await import('./owner-status');
      const payload = await buildOwnerStatus();
      snapshot = { asOf: new Date().toISOString(), payload };
    } catch {
      /* keep previous snapshot */
    }

    let withdrawals = mergeRequests(local.withdrawals, remote?.withdrawals);
    let forceWd = false;
    if (!process.env.VERCEL && process.env.CLETUS_DEMO !== '1' && withdrawals.some((r) => r.status === 'confirmed')) {
      try {
        const { processOwnerWithdrawals } = await import('./owner-withdraw-exec');
        const updated = await processOwnerWithdrawals(withdrawals);
        if (updated.length) { withdrawals = mergeRequests(withdrawals, updated); forceWd = true; }
      } catch { /* worker keeps request; retried next tick */ }
    }

    const next = saveOwnerState({ snapshot, halt, audit: local.audit, withdrawals });
    const due = opts?.forcePush || forceWd || Date.now() - lastPush > 3000;
    if (due) {
      const r = await pushOwnerState(next);
      if (r.ok) lastPush = Date.now();
    }
  } finally {
    running = false;
  }
}

/** Owner API: record a halt/resume, persist it, and try to apply immediately on the box. */
export async function requestOwnerHalt(action: 'halt' | 'resume', by: string, reason?: string) {
  const local = loadOwnerState();
  const applied = applyHaltCommand(local.halt, { action, by, reason, source: 'owner' });
  const audit = [...(local.audit ?? []), applied.audit].slice(-200);
  saveOwnerState({ ...local, halt: applied.state, audit });
  if (!process.env.VERCEL) {
    await syncHaltAndPublishSnapshot({ forcePush: true });
  } else {
    // On Vercel the worker will pull this command on its next tick.
    const { pushOwnerState, loadOwnerState: reload } = await import('./owner-store');
    await pushOwnerState(reload());
  }
  return applied;
}
