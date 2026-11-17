'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LOCAL_PAPER_KEY, newPaperAccount, parseAccount, type LocalPaperAccount } from '@/lib/local-paper';
import type { MoverCard } from '@/lib/movers';

/** Browser-local paper account, synced across tabs. */
export function useLocalPaper() {
  const [account, setAccount] = useState<LocalPaperAccount | null>(null);
  const [corrupt, setCorrupt] = useState(false);
  useEffect(() => {
    const read = () => {
      const raw = window.localStorage.getItem(LOCAL_PAPER_KEY);
      const a = parseAccount(raw);
      setCorrupt(!!raw && !a);
      setAccount(a ?? newPaperAccount());
    };
    read();
    const on = (e: StorageEvent) => { if (e.key === LOCAL_PAPER_KEY) read(); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  const save = useCallback((a: LocalPaperAccount) => { window.localStorage.setItem(LOCAL_PAPER_KEY, JSON.stringify(a)); setAccount(a); setCorrupt(false); }, []);
  const reset = useCallback(() => save(newPaperAccount()), [save]);
  return { account, save, reset, corrupt, ready: account !== null };
}

/** Polls live quotes for a set of mints. Missing quotes stay absent (unknown), never 0. */
export function useQuotes(mints: string[], intervalMs = 15_000) {
  const key = [...new Set(mints)].sort().join(',');
  const [quotes, setQuotes] = useState<Record<string, MoverCard>>({});
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (!key || busy.current) return;
    busy.current = true; setLoading(true);
    try {
      const res = await fetch(`/api/market/token?mints=${key}`, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.tokens) throw new Error(j?.message || `HTTP ${res.status}`);
      setQuotes(Object.fromEntries((j.tokens as MoverCard[]).map((t) => [t.mint, t])));
      setFetchedAt(j.fetchedAt); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Quotes unavailable'); }
    finally { busy.current = false; setLoading(false); }
  }, [key]);
  useEffect(() => {
    if (!key) { setQuotes({}); setFetchedAt(null); return; }
    void load();
    const t = window.setInterval(() => void load(), intervalMs);
    return () => window.clearInterval(t);
  }, [key, load, intervalMs]);
  return { quotes, fetchedAt, error, loading, reload: load };
}
