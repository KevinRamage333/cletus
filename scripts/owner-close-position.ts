/**
 * Owner-approved manual close of ONE open live position through the engine's own closePosition()
 * (same executor, slippage ladder, book update, trade log, rent reclaim). Run ONLY with the live
 * worker stopped, so the two processes can't both sell (the sell lock is in-process).
 * Usage: npx tsx --env-file=.env.local scripts/owner-close-position.ts <SYMBOL|positionId> [reason]
 * Never logs secrets. Profit sweep stays off in this process (WITHDRAW_LIVE_ENABLED unset).
 */
import { execSync } from 'node:child_process';

process.env.TRADING_MODE = 'live';
process.env.ALLOW_LIVE_IN_BETA = 'true';
process.env.OWNER_PLAN_ENABLED = 'true';
process.env.MCAP_PRESET = 'BALANCED';
process.env.CLETUS_DEMO = '0';
process.env.NEXT_RUNTIME ??= 'nodejs';
delete process.env.WITHDRAW_LIVE_ENABLED;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const target = process.argv[2];
  const reason = process.argv[3] ?? 'manual_take_profit';
  if (!target) throw new Error('usage: owner-close-position.ts <SYMBOL|positionId> [reason]');
  const running = (() => { try { return execSync("pgrep -f '[s]cripts/live-worker.ts'", { encoding: 'utf8' }).trim(); } catch { return ''; } })();
  if (running) throw new Error(`live worker still running (pids ${running.replace(/\n/g, ' ')}); stop it first`);

  const { buildConfig } = await import('../src/lib/config');
  const cfg = buildConfig(process.env);
  if (cfg.mode !== 'live') throw new Error(`not live: ${cfg.liveBlockedReason ?? 'unknown'}`);
  const { prisma } = await import('../src/lib/db');
  const { closePosition, mem, sampleLiveEquity } = await import('../src/lib/engine');
  const { fetchSolPriceUsd, fetchPairsForMints } = await import('../src/lib/dexscreener');

  const p = await prisma.position.findFirst({ where: { status: 'open', simulated: false, OR: [{ id: target }, { symbol: target }] } });
  if (!p) throw new Error(`no open live position matching ${target}`);
  mem.solPrice = await fetchSolPriceUsd(cfg.solPriceFallbackUsd);
  const pair = (await fetchPairsForMints([p.mint])).get(p.mint);
  const price = Number(pair?.priceUsd) || p.lastPrice;
  console.log(`[close] ${p.symbol} ${p.id} entry ${p.entryPrice} size $${p.sizeUsd} | mark ${price} (${((price / p.entryPrice - 1) * 100).toFixed(2)}%) SOL $${mem.solPrice.toFixed(2)} reason ${reason}`);

  for (let attempt = 1; attempt <= 4; attempt++) {
    await closePosition(p.id, price, reason);
    const after = await prisma.position.findUnique({ where: { id: p.id } });
    if (after?.status === 'closed') {
      console.log(`[close] CLOSED ${after.symbol} exitReason=${after.exitReason} exitPrice=${after.exitPrice} pnl=$${after.pnlUsd?.toFixed(4)} (${after.pnlPct?.toFixed(2)}%) tx=${after.exitTx}`);
      await sampleLiveEquity(); // rebaseline the live peak in-process (bot tx marked) so the sell isn't read as a deposit
      await sleep(Number(process.env.RECLAIM_RENT_DELAY_MS ?? 15_000) + 15_000); // let the engine's rent reclaim finish
      await sampleLiveEquity();
      await prisma.$disconnect();
      process.exit(0);
    }
    const f = mem.sellFailures.get(p.id);
    const wait = f ? Math.max(0, f.nextAttemptAt - Date.now()) + 500 : 5000;
    console.log(`[close] attempt ${attempt} did not close (failures=${f?.failures ?? 0}); retry in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
  console.log('[close] NOT closed after 4 attempts; position left open for the worker to manage');
  await prisma.$disconnect();
  process.exit(2);
}
main().catch((e) => { console.error(`[close] error: ${(e as Error).message}`); process.exit(1); });
