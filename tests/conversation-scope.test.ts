import { describe, expect, it } from 'vitest';
import { isWorldConversationTitle } from '../src/lib/brain/conversation-scope';

describe('conversation namespace isolation', () => {
  it('recognizes Cletus and Charlotte world conversations', () => {
    expect(isWorldConversationTitle('[World:Cletus] hello')).toBe(true);
    expect(isWorldConversationTitle('[World:Charlotte] hello')).toBe(true);
  });

  it('keeps ordinary Brain conversations in the standard namespace', () => {
    expect(isWorldConversationTitle('hello')).toBe(false);
    expect(isWorldConversationTitle('New conversation')).toBe(false);
    expect(isWorldConversationTitle('World: Cletus')).toBe(false);
  });
});
