import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { prisma } from '@/lib/db';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 const u=await requireOnboardedUser();if(u.banned)throw new HttpError(403,'Account restricted');
 const b=await req.json().catch(()=>({}));const id=String(b.id??''),message=String(b.message??''),signature=String(b.signature??'');
 if(message.length>1000||signature.length>200||!id)throw new HttpError(400,'Invalid proof');
 const application=await prisma.developerVerification.findFirst({where:{id,userId:u.id}});
 if(!application||!application.challengeHash||!application.challengeExpiresAt||application.walletProofAt)throw new HttpError(400,'No active challenge');
 if(application.challengeExpiresAt.getTime()<=Date.now())throw new HttpError(410,'Challenge expired');
 const hash=createHash('sha256').update(message).digest();
 const expected=Buffer.from(application.challengeHash,'hex');
 if(hash.length!==expected.length||!timingSafeEqual(hash,expected))throw new HttpError(400,'Challenge mismatch');
 if(!message.includes('Application: '+application.id+'\\n')||!message.includes('Wallet: '+application.wallet+'\\n')||!message.includes('Mint: '+application.mint+'\\n'))throw new HttpError(400,'Challenge scope mismatch');
 let valid=false;try{const sig=bs58.decode(signature),key=bs58.decode(application.wallet);valid=sig.length===64&&key.length===32&&nacl.sign.detached.verify(new TextEncoder().encode(message),sig,key)}catch{}
 if(!valid)throw new HttpError(400,'Invalid wallet signature');
 const changed=await prisma.developerVerification.updateMany({where:{id:application.id,userId:u.id,challengeHash:application.challengeHash,walletProofAt:null,challengeExpiresAt:{gt:new Date()}},data:{walletProofAt:new Date(),challengeHash:null,challengeExpiresAt:null}});
 if(changed.count!==1)throw new HttpError(409,'Challenge already consumed or expired');
 return NextResponse.json({walletOwnershipProved:true,developerVerified:false,message:'Wallet ownership proof recorded. Independent human review is still required.'},{headers:{'Cache-Control':'no-store'}});
}catch(e){return errorResponse(e)}}
