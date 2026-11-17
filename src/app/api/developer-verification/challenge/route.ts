import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { prisma } from '@/lib/db';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 const u=await requireOnboardedUser();if(u.banned)throw new HttpError(403,'Account restricted');
 const b=await req.json().catch(()=>({}));const id=String(b.id??'');
 const application=await prisma.developerVerification.findFirst({where:{id,userId:u.id}});
 if(!application)throw new HttpError(404,'Application not found');
 if(application.walletProofAt)throw new HttpError(409,'Wallet already proved');
 const nonce=randomBytes(32).toString('hex');
 const message=['Cletus developer wallet ownership proof','Domain: cletustechnology.dev','Application: '+application.id,'Mint: '+application.mint,'Wallet: '+application.wallet,'Nonce: '+nonce,'This is not a transaction or token approval.'].join('\n');
 const expiresAt=new Date(Date.now()+5*60*1000);
 await prisma.developerVerification.update({where:{id:application.id},data:{challengeHash:createHash('sha256').update(message).digest('hex'),challengeExpiresAt:expiresAt}});
 return NextResponse.json({id:application.id,wallet:application.wallet,message,expiresAt:expiresAt.toISOString()},{headers:{'Cache-Control':'no-store'}});
}catch(e){return errorResponse(e)}}
