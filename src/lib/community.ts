import type { User } from '@prisma/client';
import { prisma } from './db';
export const displayName = (u: Pick<User, 'displayName' | 'email'>) => u.displayName?.trim() || `${u.email.split('@')[0].slice(0, 3)}…`;
export function cleanText(s: unknown, max = 500): string {
  return String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}
/** Strip anything that looks like a private key / seed phrase so nobody leaks one into the public chat. */
export function looksSecret(s: string): boolean {
  if (/\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/.test(s)) return true; // base58 64-byte secret key
  if (/\[\s*(\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]/.test(s)) return true; // byte-array keypair
  const toks = s.trim().toLowerCase().split(/\s+/);
  return (toks.length === 12 || toks.length === 24) && toks.every((w) => /^[a-z]{3,8}$/.test(w)); // bare BIP-39-style phrase
}
export async function postMessage(userId: string, body: string, kind: 'user' | 'audit' | 'system' = 'user') {
  return prisma.communityMessage.create({ data: { userId, body, kind } });
}
