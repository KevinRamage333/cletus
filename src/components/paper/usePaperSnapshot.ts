'use client';
import { useEffect, useState } from 'react';
import type { PaperSnapshot } from '@/lib/paper-snapshot';

export type PaperState = { data: PaperSnapshot | null; state: 'loading' | 'ready' | 'error'; fetchedAt: number | null };

/** Polls the public read-only paper book (/api/live/paper). No mock fallback: on error, data stays null. */
export function usePaperSnapshot(intervalMs = 30_000): PaperState {
  const [s, setS] = useState<PaperState>({ data: null, state: 'loading', fetchedAt: null });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/live/paper', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as PaperSnapshot;
        if (alive) setS({ data: j, state: 'ready', fetchedAt: Date.now() });
      } catch {
        if (alive) setS((p) => ({ data: p.data, state: p.data ? 'ready' : 'error', fetchedAt: p.fetchedAt }));
      }
    };
    void load();
    const t = window.setInterval(load, intervalMs);
    return () => { alive = false; window.clearInterval(t); };
  }, [intervalMs]);
  return s;
}
