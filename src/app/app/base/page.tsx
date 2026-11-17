'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';

type BaseMarket = {
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd: number | null;
  volume24hUsd: number;
  liquidityUsd: number;
  fdvUsd: number | null;
  priceChange24hPct: number | null;
  url: string | null;
};

type FeeEstimate = {
  feeEstimateComplete: true;
  quote: {
    inputAmount: string;
    expectedOutputAmount: string;
    minimumOutputAmount: string;
    referencePriceUsd: number;
    poolFeeTier: number;
    warnings: string[];
  };
  estimatedL2FeeUsd: number;
  estimatedL1DataFeeUsd: number;
  estimatedTotalFeeUsd: number;
  unsignedTransactionBytes: number;
  warnings: string[];
};

const USD = (value: number | null) => value === null
  ? '—'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 6 : 2 }).format(value);

const shortAddress = (value: string) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—';

export default function BasePaperDeskPage() {
  const [markets, setMarkets] = useState<BaseMarket[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState('');
  const [tokenAddress, setTokenAddress] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [amountIn, setAmountIn] = useState('100');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [slippageBps, setSlippageBps] = useState('50');
  const [estimate, setEstimate] = useState<FeeEstimate | null>(null);
  const [estimateError, setEstimateError] = useState('');
  const [estimating, setEstimating] = useState(false);

  const loadMarkets = useCallback(async () => {
    setMarketLoading(true);
    setMarketError('');
    try {
      const response = await fetch('/api/base/markets', { credentials: 'include', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load Base markets');
      setMarkets(Array.isArray(body.markets) ? body.markets : []);
      setUpdatedAt(body.updatedAt ?? null);
    } catch (error) {
      setMarketError(error instanceof Error ? error.message : 'Could not load Base markets');
    } finally {
      setMarketLoading(false);
    }
  }, []);

  useEffect(() => { void loadMarkets(); }, [loadMarkets]);

  const requestEstimate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEstimating(true);
    setEstimate(null);
    setEstimateError('');
    try {
      const response = await fetch('/api/base/complete-fee', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenAddress,
          walletAddress,
          amountIn,
          side,
          slippageBps: Number(slippageBps),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || body.message || 'Base fee estimate failed');
      if (body.feeEstimateComplete !== true) throw new Error('The fee estimate was incomplete. No trade was placed.');
      setEstimate(body as FeeEstimate);
    } catch (error) {
      setEstimateError(error instanceof Error ? error.message : 'Base fee estimate failed');
    } finally {
      setEstimating(false);
    }
  };

  return (
    <main className="min-h-screen bg-black text-white px-4 py-6 pb-24">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/app" className="text-xs text-[#D4AF37] hover:text-[#F2D675]">← Cletus dashboard</Link>
            <h1 className="mt-2 text-2xl font-bold">Base Paper Desk</h1>
            <p className="mt-1 text-sm text-white/50">Base mainnet · Chain ID 8453 · Read-only market data and fee previews</p>
          </div>
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">PAPER ONLY · NO EXECUTION</span>
        </header>

        <section className="rounded-2xl border border-white/10 bg-[#101010] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Base market discovery</h2>
              <p className="text-xs text-white/45 mt-1">DexScreener candidates ranked by liquidity. Not buy or sell recommendations.</p>
            </div>
            <button onClick={() => void loadMarkets()} disabled={marketLoading} className="rounded-lg border border-[#D4AF37]/40 px-3 py-2 text-xs text-[#E5C76B] disabled:opacity-40">
              {marketLoading ? 'Refreshing…' : 'Refresh markets'}
            </button>
          </div>
          {marketError && <p className="mt-3 text-sm text-rose-300">{marketError}</p>}
          {marketLoading && <p className="mt-4 text-sm text-white/45">Loading Base market candidates…</p>}
          {!marketLoading && !marketError && markets.length === 0 && <p className="mt-4 text-sm text-white/45">No priced, liquid Base candidates were returned.</p>}
          {markets.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="text-white/40 border-b border-white/10">
                  <tr><th className="py-2 pr-3">Token</th><th className="py-2 pr-3">Price</th><th className="py-2 pr-3">24h</th><th className="py-2 pr-3">Liquidity</th><th className="py-2 pr-3">24h volume</th><th className="py-2">Market</th></tr>
                </thead>
                <tbody>
                  {markets.map((market) => (
                    <tr key={market.pairAddress} className="border-b border-white/5">
                      <td className="py-3 pr-3">
                        <button onClick={() => setTokenAddress(market.baseToken.address)} className="text-left hover:text-[#E5C76B]">
                          <span className="block font-semibold">{market.baseToken.symbol || market.baseToken.name || 'Unknown token'}</span>
                          <span className="block text-white/35 mt-0.5">{shortAddress(market.baseToken.address)} · {market.dexId}</span>
                        </button>
                      </td>
                      <td className="py-3 pr-3 tabular-nums">{USD(market.priceUsd)}</td>
                      <td className={`py-3 pr-3 tabular-nums ${(market.priceChange24hPct ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{market.priceChange24hPct === null ? '—' : `${market.priceChange24hPct.toFixed(2)}%`}</td>
                      <td className="py-3 pr-3 tabular-nums">{USD(market.liquidityUsd)}</td>
                      <td className="py-3 pr-3 tabular-nums">{USD(market.volume24hUsd)}</td>
                      <td className="py-3">{market.url ? <a href={market.url} target="_blank" rel="noreferrer" className="text-[#D4AF37] hover:underline">DexScreener ↗</a> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {updatedAt && <p className="mt-3 text-[11px] text-white/30">Updated {new Date(updatedAt).toLocaleString()}</p>}
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#101010] p-4">
          <h2 className="font-semibold">Complete fee estimate</h2>
          <p className="mt-1 text-xs text-white/45">Uses a Uniswap v3 quote, router gas estimate, EIP-1559 fee envelope, and Base's L1 data-fee oracle. The public wallet address is only used as an estimate input.</p>
          <form onSubmit={requestEstimate} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-white/60">Base token contract
              <input value={tokenAddress} onChange={(event) => setTokenAddress(event.target.value)} required placeholder="0x…" className="mt-1 w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37]" />
            </label>
            <label className="text-xs text-white/60">Public Base wallet address
              <input value={walletAddress} onChange={(event) => setWalletAddress(event.target.value)} required placeholder="0x… (public address only)" className="mt-1 w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37]" />
            </label>
            <label className="text-xs text-white/60">Side
              <select value={side} onChange={(event) => setSide(event.target.value as 'buy' | 'sell')} className="mt-1 w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white">
                <option value="buy">Buy (USDC input)</option><option value="sell">Sell (token input)</option>
              </select>
            </label>
            <label className="text-xs text-white/60">{side === 'buy' ? 'USDC amount' : 'Token amount'}
              <input value={amountIn} onChange={(event) => setAmountIn(event.target.value)} required inputMode="decimal" pattern="\d+(\.\d+)?" className="mt-1 w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37]" />
            </label>
            <label className="text-xs text-white/60">Slippage tolerance (basis points)
              <input value={slippageBps} onChange={(event) => setSlippageBps(event.target.value)} required inputMode="numeric" pattern="\d+" className="mt-1 w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37]" />
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={estimating} className="w-full rounded-lg bg-[#D4AF37] px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50">
                {estimating ? 'Estimating fees…' : 'Calculate complete fees'}
              </button>
            </div>
          </form>
          {estimateError && <p role="alert" className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">{estimateError} No transaction was signed or sent.</p>}
          {estimate && (
            <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4">
              <div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-emerald-200">Complete current fee estimate</h3><span className="text-[10px] text-emerald-200/70">READ ONLY</span></div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div><p className="text-[11px] text-white/40">Expected output</p><p className="mt-1 font-semibold">{estimate.quote.expectedOutputAmount}</p></div>
                <div><p className="text-[11px] text-white/40">Minimum output</p><p className="mt-1 font-semibold">{estimate.quote.minimumOutputAmount}</p></div>
                <div><p className="text-[11px] text-white/40">Pool fee tier</p><p className="mt-1 font-semibold">{estimate.quote.poolFeeTier} bps</p></div>
                <div><p className="text-[11px] text-white/40">Unsigned tx size</p><p className="mt-1 font-semibold">{estimate.unsignedTransactionBytes} bytes</p></div>
              </div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-white/10 pt-3 text-sm">
                <div><p className="text-[11px] text-white/40">L2 maximum budget</p><p className="mt-1">{USD(estimate.estimatedL2FeeUsd)}</p></div>
                <div><p className="text-[11px] text-white/40">L1 data fee</p><p className="mt-1">{USD(estimate.estimatedL1DataFeeUsd)}</p></div>
                <div><p className="text-[11px] text-white/40">Total network fee budget</p><p className="mt-1 text-[#E5C76B] font-bold">{USD(estimate.estimatedTotalFeeUsd)}</p></div>
              </div>
              <ul className="mt-3 space-y-1 text-[11px] text-white/40">{estimate.warnings.map((warning, index) => <li key={index}>• {warning}</li>)}</ul>
            </div>
          )}
        </section>
        <p className="text-[11px] leading-relaxed text-white/30">Base is not enabled in Cletus's automated paper engine. This desk is an isolated read-only research and fee-estimation surface. It does not persist positions, create approvals, sign transactions, or broadcast swaps.</p>
      </div>
    </main>
  );
}
