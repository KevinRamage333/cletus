import { prisma } from '@/lib/db';

export const ERASED_POST_BODY = '[removed at the member’s request]';

/**
 * L-103b: the community's answer to a member deletion request.
 * Posts with moderation history cannot be deleted (RESTRICT + append-only events), so the member is anonymised instead:
 * post and message bodies are replaced, the community opt-in is withdrawn (their paper trades leave every aggregate),
 * and identifying profile fields are cleared. Moderation events and post ids/status stay intact for the audit trail.
 * Idempotent. Does not touch trading records, onboarding acceptances or anything outside the community and profile.
 *
 * INTENTIONALLY NOT WIRED. Before anything calls this it must sit behind an audited, admin-only path that also
 * revokes the member's sessions (logs them out) and bans the account, and records who erased whom and when.
 * On its own it leaves the account usable. Note that withdrawing the opt-in removes the member's trades from the
 * community aggregate, which changes already published figures (documented residual).
 */
export async function anonymiseCommunityMember(userId: string): Promise<{ posts: number; messages: number }> {
  return prisma.$transaction(async (tx) => {
    const posts = await tx.communityPost.updateMany({ where: { userId }, data: { body: ERASED_POST_BODY } });
    const messages = await tx.communityMessage.updateMany({ where: { userId }, data: { body: ERASED_POST_BODY, hidden: true, hiddenBy: 'member-erasure' } });
    await tx.communityOptIn.upsert({ where: { userId }, update: { optedIn: false, optedInAt: null }, create: { userId, optedIn: false, optedInAt: null } });
    await tx.user.update({
      where: { id: userId },
      data: { email: `erased-${userId}@erased.invalid`, displayName: null, bio: null, walletPublicKey: null, walletSource: null },
    });
    return { posts: posts.count, messages: messages.count };
  });
}
