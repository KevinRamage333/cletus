'use client';
/**
 * Real-time token chart: native candlesticks (TradingView lightweight-charts) fed by GeckoTerminal OHLCV through
 * /api/tokens/chart (server-cached + rate-limited), with Cletus's own buy/sell markers; plus GeckoTerminal and
 * DexScreener embeds. Gold theme.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
type View = 'native' | 'gecko' | 'dex';
const RANGES = ['1H', '4H', '1D', '1W', '1M'] as const;
const REFRESH: Record<string, number> = { '1H': 15_000, '4H': 20_000, '1D': 30_000, '1W': 120_000, '1M': 300_000 };
const fmt = (p?: number | null) => (p === null || p === undefined ? '—' : p < 0.0001 ? p.toExponential(3) : p < 1 ? p.toFixed(6) : p.toFixed(4));
const big = (n?: number | null) => (n === null || n === undefined ? '—' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);

export default function TokenChart({ address, pool: poolHint, height = 420, compact = false, initialView = 'native', apiBase = '/api/tokens/chart' }: { apiBase?: string; address: string; pool?: string | null; height?: number; compact?: boolean; initialView?: View }) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<{ candles: any; volume: any } | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]>('1H');
  const [view, setView] = useState<View>(initialView);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ address, range });
      if (poolHint) qs.set('pool', poolHint);
      const r = await fetch(`${apiBase}?${qs}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'chart unavailable');
      setData(d); setErr(null); setUpdated(new Date());
      if (view === 'native' && !d.candles?.length && !d.rateLimited) setView('gecko');
    } catch (e) { setErr((e as Error).message); }
  }, [address, range, poolHint, view, apiBase]);

  useEffect(() => { load(); const t = setInterval(load, REFRESH[range] ?? 30_000); return () => clearInterval(t); }, [load, range]);

  // Create the lightweight-charts instance once per mount of the native view.
  useEffect(() => {
    if (view !== 'native' || !box.current) return;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const lw = await import('lightweight-charts');
      if (disposed || !box.current) return;
      const chart = lw.createChart(box.current, {
        height, layout: { background: { color: '#0b0a07' }, textColor: '#cbbf93' },
        grid: { vertLines: { color: 'rgba(212,175,55,0.07)' }, horzLines: { color: 'rgba(212,175,55,0.07)' } },
        rightPriceScale: { borderColor: 'rgba(212,175,55,0.25)' }, timeScale: { borderColor: 'rgba(212,175,55,0.25)', timeVisible: true, secondsVisible: false },
        crosshair: { mode: 1 },
      });
      const candles = chart.addCandlestickSeries({ upColor: '#D4AF37', borderUpColor: '#F59E0B', wickUpColor: '#F59E0B', downColor: '#7f1d1d', borderDownColor: '#ef4444', wickDownColor: '#ef4444', priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 } });
      const volume = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, color: 'rgba(212,175,55,0.25)' });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      chartRef.current = chart; seriesRef.current = { candles, volume };
      ro = new ResizeObserver(() => box.current && chart.applyOptions({ width: box.current.clientWidth }));
      ro.observe(box.current);
      setData((d: any) => (d ? { ...d } : d)); // trigger a paint with any data already loaded
    })();
    return () => { disposed = true; ro?.disconnect(); chartRef.current?.remove(); chartRef.current = null; seriesRef.current = null; };
  }, [view, height]);

  // Paint candles + markers.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !data?.candles) return;
    const c = data.candles as { time: number; open: number; high: number; low: number; close: number; volume: number }[];
    s.candles.setData(c.map((x) => ({ time: x.time, open: x.open, high: x.high, low: x.low, close: x.close })));
    s.volume.setData(c.map((x) => ({ time: x.time, value: x.volume, color: x.close >= x.open ? 'rgba(212,175,55,0.35)' : 'rgba(239,68,68,0.3)' })));
    const first = c[0]?.time ?? 0;
    const step = c.length > 1 ? c[1].time - c[0].time : 60;
    const snap = (t: number) => (c.length ? c.reduce((best, x) => (Math.abs(x.time - t) < Math.abs(best - t) ? x.time : best), c[0].time) : t);
    const markers = (data.markers ?? []).filter((m: any) => m.time >= first - step).map((m: any) => ({
      time: snap(m.time), position: m.side === 'buy' ? 'belowBar' : 'aboveBar', color: m.side === 'buy' ? '#F59E0B' : m.pnlUsd >= 0 ? '#22c55e' : '#ef4444',
      shape: m.side === 'buy' ? 'arrowUp' : 'arrowDown', text: m.side === 'buy' ? `BUY $${Number(m.sizeUsd).toFixed(0)}` : `SELL ${m.pnlUsd >= 0 ? '+' : ''}$${Number(m.pnlUsd ?? 0).toFixed(2)}`,
    }));
    // Whale / smart-money big movers (Helius, ≥ whale threshold) as small circles.
    const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
    const whales = (data.whaleMarkers ?? []).filter((m: any) => m.time >= first - step).slice(-40).map((m: any) => ({
      time: snap(m.time), position: m.side === 'buy' ? 'belowBar' : 'aboveBar', color: m.side === 'buy' ? '#38bdf8' : '#e879f9', shape: 'circle', text: `whale ${m.side} $${k(m.usd)}`,
    }));
    s.candles.setMarkers([...markers, ...whales].sort((a: any, b: any) => a.time - b.time));
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  const chg = data?.change24h;
  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-[#0b0a07] overflow-hidden">
      {!compact && (
        <div className="px-4 pt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div className="text-lg font-bold">{data?.symbol ?? '…'} <span className="text-xs text-white/40 font-normal">/ {data?.quote ?? ''} · {data?.dexId ?? ''}</span></div>
          <div className="font-mono text-emerald-400">${fmt(data?.priceUsd)}</div>
          {chg !== null && chg !== undefined && <div className={`text-xs font-mono ${chg >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{chg >= 0 ? '+' : ''}{Number(chg).toFixed(2)}% 24h</div>}
          <div className="text-xs text-white/40">MCap {big(data?.mcap)} · Vol {big(data?.volume24h)} · Liq {big(data?.liquidityUsd)}</div>
        </div>
      )}
      <div className="px-3 py-2 flex flex-wrap items-center gap-1.5 text-xs">
        {(['native', 'gecko', 'dex'] as View[]).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-full border ${view === v ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10' : 'border-white/10 text-white/50'}`}>{v === 'native' ? 'Candles + trades' : v === 'gecko' ? 'GeckoTerminal' : 'DexScreener'}</button>
        ))}
        {view === 'native' && <span className="mx-1 text-white/20">|</span>}
        {view === 'native' && RANGES.map((r) => (
          <button key={r} onClick={() => setRange(r)} className={`px-2 py-1 rounded font-mono ${range === r ? 'text-emerald-400' : 'text-white/40'}`}>{r}</button>
        ))}
        <span className="ml-auto text-[10px] text-white/30 font-mono">{data?.rateLimited ? 'rate-limited · cached' : updated ? `updated ${updated.toLocaleTimeString()}` : ''}</span>
      </div>
      {err && <div className="px-4 pb-3 text-xs text-red-400">{err}</div>}
      {view === 'native' && (
        <>
          <div ref={box} style={{ height }} className="w-full" />
          {data && !data.candles?.length && <div className="px-4 py-2 text-xs text-white/40">No candles from GeckoTerminal for this pool yet. Try the GeckoTerminal or DexScreener tab.</div>}
          <div className="px-4 py-1.5 text-[10px] text-white/30">Candles: GeckoTerminal OHLCV (auto-refresh {Math.round((REFRESH[range] ?? 30000) / 1000)}s, cached server-side). Arrows: your Cletus {data?.markers?.length ? `trades (${data.markers.length})` : 'trades (none in range)'}. Circles: whale swaps {data?.whaleMarkers?.length ? `(${data.whaleMarkers.length}, Helius)` : '(none tracked)'}{data?.whaleMarkers?.length ? <> · <a className="underline" href={data.whaleMarkers[data.whaleMarkers.length - 1].solscan} target="_blank" rel="noreferrer">latest on Solscan</a></> : null}.</div>
        </>
      )}
      {view !== 'native' && data?.embeds && (
        <iframe key={view} title={`${view} chart`} src={view === 'gecko' ? data.embeds.geckoterminal : data.embeds.dexscreener} style={{ height: height + 80 }} className="w-full border-0" allow="clipboard-write" allowFullScreen />
      )}
    </div>
  );
}
