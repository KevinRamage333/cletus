/** Browser-only, bounded cache for non-sensitive chat display state.
 * The authenticated Prisma conversation store remains authoritative.
 * Keys must be scoped by user and conversation; never cache secrets.
 */
export const CHAT_CACHE_TTL_MS = 55 * 60 * 60 * 1000;
const MAX_MESSAGES = 500;

export type Timestamped = { timestamp: number };

export function chatCacheKey(userId: string, conversationId: string): string {
  if (!userId || !conversationId) throw new Error("Chat cache requires user and conversation IDs");
  return `cletus:chat:v1:${encodeURIComponent(userId)}:${encodeURIComponent(conversationId)}`;
}

function isTimestamped(value: unknown): value is Timestamped {
  if (typeof value !== "object" || value === null) return false;
  const timestamp = (value as Record<string, unknown>).timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    && timestamp >= 0 && timestamp <= Date.now() + 60_000;
}

export function loadRecentMessages<T extends Timestamped>(key: string, fallback: T[] = []): T[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const cutoff = Date.now() - CHAT_CACHE_TTL_MS;
    return parsed.filter((m): m is T => isTimestamped(m) && m.timestamp >= cutoff).slice(-MAX_MESSAGES);
  } catch {
    return fallback;
  }
}

export function saveMessages<T extends Timestamped>(key: string, messages: readonly T[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    const cutoff = Date.now() - CHAT_CACHE_TTL_MS;
    const recent = messages.filter((m) => isTimestamped(m) && m.timestamp >= cutoff).slice(-MAX_MESSAGES);
    window.localStorage.setItem(key, JSON.stringify(recent));
    return true;
  } catch {
    return false;
  }
}

export function clearCachedMessages(key: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(key); } catch { /* storage unavailable */ }
}
