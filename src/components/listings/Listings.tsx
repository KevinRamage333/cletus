'use client';
/** Display-only Cletus Verified badge, Boosted tag and the shared listings overlay hook. */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { MoverCard } from '@/lib/movers';
import type { BoostSummary } from '@/lib/token-boost';

export interface ListingsData { verified: string[]; boosts: BoostSummary[]; boostedCards: MoverCard[]; at: string }

export function useListings(withCards = false, intervalMs = 30_000) {
  const [data, setData] = useState<ListingsData | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/listings${withCards ? '?cards=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      if (r.ok) setData(await r.json());
    } catch { /* overlay is optional; the board still renders */ }
  }, [withCards]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), intervalMs); return () => clearInterval(t); }, [load, intervalMs]);
  const isVerified = useCallback((network: string, token: string) => !!data?.verified.includes(`${network}:${token}`), [data]);
  const boostOf = useCallback((network: string, token: string) => data?.boosts.find((b) => b.network === network && b.token === token) ?? null, [data]);
  return { data, isVerified, boostOf, reload: load };
}

export function VerifiedBadge({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/app/verified" title="Cletus Verified: automated ownership + safety check. Not advice or endorsement." data-testid="verified-badge"
      className="inline-flex items-center gap-1 border border-[#d4af37]/70 bg-gradient-to-r from-[#d4af37]/25 to-[#f3dc95]/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#f3dc95]">
      <span aria-hidden>✓</span>{compact ? 'Verified' : 'Cletus Verified'}
    </Link>
  );
}

export function BoostedTag({ expiresAt }: { expiresAt?: string }) {
  return (
    <span title={`Paid promotion${expiresAt ? ` until ${new Date(expiresAt).toLocaleString()}` : ''}. Not a Cletus signal.`} data-testid="boosted-tag"
      className="inline-flex items-center gap-1 border border-[#e3c06a] bg-[#d4af37] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-black">
      <span aria-hidden>⚡</span>Boosted
    </span>
  );
}
