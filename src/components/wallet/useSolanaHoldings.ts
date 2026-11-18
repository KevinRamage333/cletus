'use client';
import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PKoKwKxH5HTLjn'];
export interface SplHolding { mint: string; uiAmount: number; decimals: number }

/** Native SOL plus SPL/Token-2022 balances for a connected address, read from public RPC. */
export function useSolanaHoldings(owner: PublicKey | null, withTokens = false) {
  const { connection } = useConnection();
  const [sol, setSol] = useState<number | null>(null);
  const [tokens, setTokens] = useState<SplHolding[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    if (!owner) return;
    setLoading(true);
    try {
      const lamports = await connection.getBalance(owner, 'confirmed');
      setSol(lamports / LAMPORTS_PER_SOL);
      if (withTokens) {
        const res = await Promise.all(TOKEN_PROGRAMS.map((p) => connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(p) })));
        const list: SplHolding[] = [];
        for (const r of res) for (const a of r.value) {
          const info = (a.account.data as { parsed?: { info?: { mint: string; tokenAmount: { uiAmount: number | null; decimals: number } } } }).parsed?.info;
          if (info && (info.tokenAmount.uiAmount ?? 0) > 0) list.push({ mint: info.mint, uiAmount: info.tokenAmount.uiAmount as number, decimals: info.tokenAmount.decimals });
        }
        setTokens(list.sort((a, b) => b.uiAmount - a.uiAmount));
      }
      setFetchedAt(Date.now()); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message.slice(0, 160) : 'RPC unavailable'); }
    finally { setLoading(false); }
  }, [connection, owner, withTokens]);
  useEffect(() => { if (!owner) { setSol(null); setTokens(null); setFetchedAt(null); setError(null); return; } void refresh(); const t = window.setInterval(() => void refresh(), 60_000); return () => window.clearInterval(t); }, [owner, refresh]);
  return { sol, tokens, fetchedAt, error, loading, refresh };
}
