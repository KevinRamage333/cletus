'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MoverCard } from '@/lib/movers';

export type LoadState = 'loading' | 'ready' | 'empty' | 'error';
export interface MoversData { tokens: MoverCard[]; fetchedAt: string | null; stale: boolean; errors: string[] }

/** Polls the public movers board. Keeps the last good board on failure and reports it as stale. */
export function useMovers(intervalMs = 15_000) {
  const [data, setData] = useState<MoversData | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await fetch('/api/market/movers', { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !Array.isArray(j.tokens)) throw new Error(j?.message || `HTTP ${res.status}`);
      setData({ tokens: j.tokens, fetchedAt: j.fetchedAt ?? null, stale: !!j.stale, errors: j.errors ?? [] });
      setError(null);
      setState(j.tokens.length ? 'ready' : 'empty');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Market data unavailable');
      setState((s) => (s === 'ready' ? 'ready' : 'error'));
    } finally {
      busy.current = false;
    }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, intervalMs);
    return () => window.clearInterval(t);
  }, [load, intervalMs]);
  return { data, state, error, reload: load };
}
