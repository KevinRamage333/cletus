import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { ensureOperatorAccount, monitorDeadlineMs, monitorTick, scanDeadlineMs, scanTick } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const WORK_BUDGET_MS = 42_000;
const LEASE_SECONDS = 110;
const HEARTBEAT = 'PAPER_WORKER_HEARTBEAT';

/** Vercel invokes this route with Authorization: Bearer CRON_SECRET. Never accept anonymous ticks. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ok:false,error:'CRON_SECRET missing'},{status:503});
  if (req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ok:false,error:'Unauthorized'},{status:401});
  if (process.env.CLETUS_ENGINE_TRANSPORT !== 'cron') return NextResponse.json({ok:false,error:'Cron transport disabled'},{status:409});
  if (process.env.CLETUS_DEMO === '1'||process.env.CLETUS_DEMO === 'true'||process.env.ENGINE_DISABLED === 'true') return NextResponse.json({ok:false,error:'Paper engine disabled'},{status:409});
  if (getConfig().mode !== 'simulation') return NextResponse.json({ok:false,error:'Simulation mode required'},{status:409});

  const token = randomUUID();
  let acquired = false;
  try {
    // A short atomic DB lease, not a long transaction around external RPC calls.
    // The old transaction used the global Prisma client inside the callback, so
    // its advisory lock did not protect scanTick/monitorTick's writes.
    const rows = await prisma.$queryRaw<Array<{token:string}>>`
      INSERT INTO "app"."PaperWorkerLease" ("id", "token", "expiresAt", "updatedAt")
      VALUES ('global', ${token}, NOW() + (${LEASE_SECONDS} * INTERVAL '1 second'), NOW())
      ON CONFLICT ("id") DO UPDATE SET
        "token" = EXCLUDED."token", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = NOW()
      WHERE "app"."PaperWorkerLease"."expiresAt" < NOW()
      RETURNING "token"
    `;
    acquired = rows[0]?.token === token;
    if (!acquired) return NextResponse.json({ok:true,skipped:true,reason:'Previous tick still holds lease'});
    const started = performance.now();
    await prisma.logEntry.create({data:{level:'info',message:`${HEARTBEAT} started lease=${token}`,accountId:null}});
    const monitorBudget = Math.min(18_000,monitorDeadlineMs(),Math.max(0,WORK_BUDGET_MS-(performance.now()-started)));
    const monitorCompleted = monitorBudget>0 && await monitorTick(monitorBudget);
    let scanSummary = 'scan skipped: monitor incomplete';
    if (monitorCompleted) {
      await ensureOperatorAccount();
      const remaining = Math.floor(WORK_BUDGET_MS-(performance.now()-started));
      scanSummary = remaining>0 ? await scanTick(Math.min(scanDeadlineMs(),remaining)) : 'scan skipped: budget exhausted';
    }
    await prisma.logEntry.create({data:{level:'info',message:`${HEARTBEAT} completed monitor=${monitorCompleted} scan=${scanSummary.slice(0,250)}`,accountId:null}});
    return NextResponse.json({ok:true,mode:'simulation',monitorCompleted,scanSummary,heartbeatAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
  } catch(e) {
    const message=e instanceof Error?e.message:'Unknown error';
    try { await prisma.logEntry.create({data:{level:'error',message:`PAPER_WORKER_ERROR ${message.slice(0,450)}`,accountId:null}}); } catch { /* preserve failure */ }
    return NextResponse.json({ok:false,error:'Paper worker failed'},{status:500});
  } finally {
    if(acquired) { try { await prisma.$executeRaw`DELETE FROM "app"."PaperWorkerLease" WHERE "id"='global' AND "token"=${token}`; } catch { /* lease expires */ } }
  }
}
