import type { User } from '@prisma/client';
export const displayName = (u: Pick<User, 'displayName' | 'email'>) => u.displayName?.trim() || `${u.email.split('@')[0].slice(0, 3)}…`;
export function cleanText(s: unknown, max = 500): string {
  return String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}
/** Reject private keys and recovery phrases, including a phrase embedded in a longer message. */
export function looksSecret(s: string): boolean {
  if (/[1-9A-HJ-NP-Za-km-z]{80,90}/.test(s)) return true; // base58 64-byte secret key
  if (/\[\s*(?:\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]/.test(s)) return true; // byte-array keypair
  // 12 to 24 consecutive short words, anywhere in the message — not only a message that is nothing else.
  return /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/i.test(s);
}

/**
 * Community announcements enter the moderated feed as pending posts.
 * They are not inserted as immediately visible chat rows.
 */
export async function postMessage(userId: string, body: string, _kind: 'user' | 'audit' | 'system' = 'user') {
  const { submitCommunityPost } = await import('./community-feed');
  const post = await submitCommunityPost(userId, body);
  return { id: post.id, userId, body: post.body, createdAt: new Date(post.createdAt), status: post.status };
}
