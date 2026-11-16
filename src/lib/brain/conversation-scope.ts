/**
 * Conversation namespace helpers. World companions have a separate history
 * from the standard Brain chat and must not leak through Brain endpoints.
 */
export const WORLD_CONVERSATION_PREFIX = '[World:';

export function isWorldConversationTitle(title: string): boolean {
  return title.startsWith(WORLD_CONVERSATION_PREFIX);
}
