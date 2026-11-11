import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const cmd = process.argv[2];
if (cmd === 'delete') { const r = await p.user.deleteMany({ where: { email: process.argv[3] } }); console.log('deleted', r.count); }
console.log(JSON.stringify(await p.user.findMany({ select: { email: true, isAdmin: true, termsVersion: true, riskVersion: true, walletSetupAt: true } })));
const acc = await p.acceptance.findMany({ select: { userId: true, kind: true, version: true, createdAt: true } });
console.log('acceptances', acc.length);
await p.$disconnect();
