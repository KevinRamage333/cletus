import type { User } from '@prisma/client';
import { wordlist as BIP39_ENGLISH } from '@scure/bip39/wordlists/english.js';

const BIP39_WORDS: ReadonlySet<string> = new Set(BIP39_ENGLISH);
/** Valid BIP-39 mnemonic lengths. */
export const MNEMONIC_LENGTHS = [12, 15, 18, 21, 24] as const;
const MIN_MNEMONIC = MNEMONIC_LENGTHS[0];

/**
 * True when the text holds a run of at least 12 consecutive BIP-39 English words
 * (so it contains a 12/15/18/21/24-word window). Numbers, list markers and punctuation
 * between words are ignored so "1. abandon 2. ability" and comma-separated phrases still count.
 * Ordinary sentences break the run on the first word that is not in the BIP-39 list.
 */
export function containsRecoveryPhrase(s: string): boolean {
  const words = s.toLowerCase().match(/[a-z]+/g) ?? [];
  let run = 0;
  for (const w of words) {
    run = BIP39_WORDS.has(w) ? run + 1 : 0;
    if (run >= MIN_MNEMONIC) return true;
  }
  return false;
}
export const displayName = (u: Pick<User, 'displayName' | 'email'>) => u.displayName?.trim() || `${u.email.split('@')[0].slice(0, 3)}…`;
export function cleanText(s: unknown, max = 500): string {
  return String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}
/** Reject private keys and recovery phrases, including a phrase embedded in a longer message. */
export function looksSecret(s: string): boolean {
  if (/[1-9A-HJ-NP-Za-km-z]{80,90}/.test(s)) return true; // base58 64-byte secret key
  if (/\[\s*(?:\d{1,3}\s*,\s*){31,}\d{1,3}\s*\]/.test(s)) return true; // byte-array keypair
  // A recovery phrase anywhere in the message, not only a message that is nothing else.
  return containsRecoveryPhrase(s);
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
