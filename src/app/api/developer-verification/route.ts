import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { parseAddress } from '@/lib/inspector';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { const u=await requireOnboardedUser(); const requests=await prisma.developerVerification.findMany({where:{userId:u.id},orderBy:{createdAt:'desc'},take:30,select:{id:true,mint:true,wallet:true,projectName:true,status:true,reviewNote:true,walletProofAt:true,createdAt:true,reviewedAt:true}});return NextResponse.json({requests},{headers:{'Cache-Control':'no-store'}}); } catch(e){return errorResponse(e)}
}
export async function POST(req:Request) {
  try {
    const u=await requireOnboardedUser(); if(u.banned) throw new HttpError(403,'Account restricted');
    const b=await req.json().catch(()=>({}));
    const mint=parseAddress(String(b.mint??'')),wallet=parseAddress(String(b.wallet??''));
    const projectName=String(b.projectName??'').trim(),statement=String(b.statement??'').trim();
    const evidenceUrl=String(b.evidenceUrl??'').trim();
    if(!mint||!wallet||projectName.length<3||projectName.length>100||statement.length<30||statement.length>2000) throw new HttpError(400,'Valid Solana mint, wallet, project name (3–100 chars) and statement (30–2000 chars) required');
    if(evidenceUrl && (evidenceUrl.length>500 || !/^https:\/\//i.test(evidenceUrl))) throw new HttpError(400,'Evidence link must be HTTPS and under 500 characters');
    const existing=await prisma.developerVerification.findUnique({where:{userId_mint:{userId:u.id,mint}}});
    if(existing) throw new HttpError(409,'You already submitted this token. Review its existing status.');
    const result=await prisma.developerVerification.create({data:{userId:u.id,mint,wallet,projectName,statement,evidenceUrl:evidenceUrl||null},select:{id:true,status:true,createdAt:true}});
    return NextResponse.json({request:result,message:'Application received. This does not verify wallet ownership or award a badge.'},{status:201,headers:{'Cache-Control':'no-store'}});
  } catch(e){return errorResponse(e)}
}
