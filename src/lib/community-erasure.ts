import { prisma } from '@/lib/db';

export const ERASED_POST_BODY = '[removed at the member’s request]';

/**
 * L-103b: the community's answer to a member deletion request.
 * Posts with moderation history cannot be deleted (RESTRICT + append-only events), so the member is anonymised instead:
 * post and message bodies are replaced, the community opt-in is withdrawn (their paper trades leave every aggregate),
 * and identifying profile fields are cleared. Moderation events and post ids/status stay intact for the audit trail.
 * Idempotent. Does not touch trading records, onboarding acceptances or anything outside the community and profile.
 */
export async function anonymiseCommunityMember(userId: string): Promise<{ posts: number; messages: number }> {
  return prisma.$transaction(async (tx) => {
    const posts = await tx.communityPost.updateMany({ where: { userId }, data: { body: ERASED_POST_BODY } });
    const messages = await tx.communityMessage.updateMany({ where: { userId }, data: { body: ERASED_POST_BODY, hidden: true, hiddenBy: 'member-erasure' } });
    await tx.communityOptIn.upsert({ where: { userId }, update: { optedIn: false }, create: { userId, optedIn: false } });
    await tx.user.update({
      where: { id: userId },
      data: { email: `erased-${userId}@erased.invalid`, displayName: null, bio: null, walletPublicKey: null, walletSource: null },
    });
    return { posts: posts.count, messages: messages.count };
  });
}
