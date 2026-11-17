import { describe, expect, it, vi, afterEach } from 'vitest';
import { CHAT_CACHE_TTL_MS, chatCacheKey, loadRecentMessages, saveMessages } from '../src/lib/chatStorage';

afterEach(() => vi.unstubAllGlobals());

describe('55-hour chat cache', () => {
  it('scopes keys by user and conversation', () => {
    expect(chatCacheKey('user1', 'conversation1')).not.toBe(chatCacheKey('user2', 'conversation1'));
  });
  it('returns fallback on server', () => {
    expect(loadRecentMessages('test', [{ timestamp: 1 }])).toEqual([{ timestamp: 1 }]);
  });
  it('rejects invalid payloads and expires old messages', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    } });
    store.set('bad', '{}');
    expect(loadRecentMessages('bad')).toEqual([]);
    const recent = { timestamp: Date.now(), content: 'ok' };
    const old = { timestamp: Date.now() - CHAT_CACHE_TTL_MS - 1, content: 'old' };
    expect(saveMessages('good', [old, recent])).toBe(true);
    expect(loadRecentMessages('good')).toEqual([recent]);
  });
});
