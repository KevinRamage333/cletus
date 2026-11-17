import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { prisma } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function GET(){try{const u=await requireOnboardedUser();if(!u.isAdmin)throw new HttpError(403,'Admin only');const requests=await prisma.developerVerification.findMany({orderBy:{createdAt:'desc'},take:100,select:{id:true,mint:true,wallet:true,projectName:true,evidenceUrl:true,statement:true,status:true,walletProofAt:true,badgeIssuedAt:true,badgeExpiresAt:true,badgeRevokedAt:true,reviewNote:true,createdAt:true,reviewedAt:true,user:{select:{displayName:true,email:true}},reviewEvents:{orderBy:{createdAt:'desc'},take:10,select:{action:true,reason:true,createdAt:true}}}});return NextResponse.json({requests},{headers:{'Cache-Control':'no-store'}})}catch(e){return errorResponse(e)}}
export async function PATCH(req:Request){try{
 const u=await requireOnboardedUser();if(!u.isAdmin)throw new HttpError(403,'Admin only');
 const b=await req.json().catch(()=>({}));const id=String(b.id??''),action=String(b.status??''),note=String(b.note??'').trim();
 if(!id||!['needs_evidence','rejected','approved','revoked'].includes(action)||note.length<10||note.length>1000)throw new HttpError(400,'Invalid action or review reason (10–1000 characters)');
 const now=new Date();
 const result=await prisma.$transaction(async tx=>{
   const identity=await tx.developerVerification.findUnique({where:{id},select:{mint:true}});
   if(!identity)throw new HttpError(404,'Application not found');
   // Serialize all review transitions for the mint before reading current status.
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.mint}, 0))`;
   const application=await tx.developerVerification.findUnique({where:{id}});
   if(!application)throw new HttpError(404,'Application not found');
   if(action==='approved'){
     if(!application.walletProofAt)throw new HttpError(409,'Wallet ownership proof is required');
     if(application.status==='approved'&&application.badgeExpiresAt&&application.badgeExpiresAt>now&&!application.badgeRevokedAt)throw new HttpError(409,'Badge already active');
     if(application.status==='rejected'||application.status==='revoked')throw new HttpError(409,'Rejected or revoked application cannot be reapproved; a new independent review process is required');
     const other=await tx.developerVerification.findFirst({where:{mint:application.mint,status:'approved',badgeExpiresAt:{gt:now},badgeRevokedAt:null,id:{not:id}},select:{id:true}});
     if(other)throw new HttpError(409,'Another active badge already exists for this mint');
   } else if(action==='revoked'){
     if(application.status!=='approved'||application.badgeRevokedAt)throw new HttpError(409,'Only active approved badges may be revoked');
   } else if(application.status==='approved'||application.status==='revoked')throw new HttpError(409,'Use revoke for issued badges');
   const data={status:action,reviewNote:note,reviewerId:u.id,reviewedAt:now,...(action==='approved'?{badgeIssuedAt:now,badgeExpiresAt:new Date(now.getTime()+90*24*60*60*1000),badgeRevokedAt:null}:{}),...(action==='revoked'?{badgeRevokedAt:now}:{})};
   const updated=await tx.developerVerification.update({where:{id},data,select:{id:true,status:true,reviewedAt:true,badgeExpiresAt:true,badgeRevokedAt:true}});
   await tx.developerVerificationEvent.create({data:{applicationId:id,actorId:u.id,action,reason:note}});
   return updated;
 });
 return NextResponse.json({request:result,message:action==='approved'?'Badge issued for 90 days':action==='revoked'?'Badge revoked':'Review recorded'},{headers:{'Cache-Control':'no-store'}});
}catch(e){return errorResponse(e)}}
