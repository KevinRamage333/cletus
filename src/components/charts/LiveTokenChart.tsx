'use client';
/**
 * Live price chart for one Solana token, in the black/metallic-gold app style.
 * Candles: GeckoTerminal OHLCV; price/pool: DexScreener — both through the public /api/market/chart route.
 * Polls while visible, keeps the last good chart on failure, gains green / losses red.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CHART_RANGES, CHART_REFRESH_MS, GAIN, LOSS, type ChartRange } from '@/lib/live-chart';
import { formatPct, formatPrice, formatUsdCompact } from '@/lib/movers';

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type ChartData = { mint: string; pool: string; symbol: string | null; name: string | null; quote: string | null; dexId: string | null; priceUsd: number | null; change24h: number | null; volume24h: number | null; mcap: number | null; liquidityUsd: number | null; candles: Candle[]; stale: boolean; rateLimited: boolean; fetchedAt: string; dexscreener: string };

export interface LiveTokenChartProps { address?: string | null; symbol?: string | null; pool?: string | null; height?: number; title?: string; testId?: string; note?: string }

export default function LiveTokenChart({ address, symbol, pool, height = 360, title, testId = 'live-chart', note }: LiveTokenChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const series = useRef<{ chart: any; candles: any; volume: any } | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [range, setRange] = useState<ChartRange>('1H');
  const [data, setData] = useState<ChartData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const key = address || symbol || '';

  const load = useCallback(async () => {
    if (!key) return;
    try {
      const qs = new URLSearchParams({ range });
      if (address) qs.set('address', address); else if (symbol) qs.set('q', symbol);
      if (pool) qs.set('pool', pool);
      const res = await fetch(`/api/market/chart?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j) throw new Error(j?.message || `Chart data unavailable (HTTP ${res.status})`);
      setData(j); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Chart data unavailable'); }
    finally { setLoading(false); }
  }, [key, address, symbol, pool, range]);

  useEffect(() => { setData(null); setLoading(true); setErr(null); }, [key]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, CHART_REFRESH_MS[range]);
    return () => window.clearInterval(t);
  }, [load, range]);

  // One chart instance per mount.
  useEffect(() => {
    let disposed = false; let ro: ResizeObserver | null = null;
    (async () => {
      const lw = await import('lightweight-charts');
      if (disposed || !box.current) return;
      const chart = lw.createChart(box.current, {
        width: box.current.clientWidth, height,
        layout: { background: { color: '#0a0907' }, textColor: '#b9ad8a', fontSize: 11 },
        grid: { vertLines: { color: 'rgba(212,175,55,0.06)' }, horzLines: { color: 'rgba(212,175,55,0.06)' } },
        rightPriceScale: { borderColor: 'rgba(212,175,55,0.25)' },
        timeScale: { borderColor: 'rgba(212,175,55,0.25)', timeVisible: true, secondsVisible: false },
        crosshair: { mode: 1 },
      });
      const candles = chart.addCandlestickSeries({ upColor: GAIN, borderUpColor: GAIN, wickUpColor: GAIN, downColor: LOSS, borderDownColor: LOSS, wickDownColor: LOSS, priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 } });
      const volume = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, color: 'rgba(212,175,55,0.25)' });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      series.current = { chart, candles, volume };
      ro = new ResizeObserver(() => { if (box.current) chart.applyOptions({ width: box.current.clientWidth }); });
      ro.observe(box.current);
      setReady(true);
    })();
    return () => { disposed = true; ro?.disconnect(); series.current?.chart.remove(); series.current = null; setReady(false); };
  }, [height]);

  useEffect(() => {
    const s = series.current;
    if (!s || !ready) return;
    const c = data?.candles ?? [];
    s.candles.setData(c.map((x) => ({ time: x.time, open: x.open, high: x.high, low: x.low, close: x.close })));
    s.volume.setData(c.map((x) => ({ time: x.time, value: x.volume, color: x.close >= x.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)' })));
    if (c.length) s.chart.timeScale().fitContent();
  }, [data, ready]);

  const chg = data?.change24h ?? null;
  const hasCandles = !!data?.candles?.length;
  const state = !key ? 'empty' : hasCandles ? (err || data?.stale ? 'stale' : 'live') : loading ? 'loading' : err ? 'error' : 'empty';
  return (
    <section className="panel overflow-hidden" data-testid={testId} data-state={state} aria-label={title ?? 'Live price chart'}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[rgba(212,175,55,.14)] px-4 py-3">
        <div className="min-w-0">
          {title && <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#e3c06a]">{title}</p>}
          <p className="truncate text-base font-bold text-[#f6f1e4]" data-testid={`${testId}-symbol`}>{data?.symbol ?? symbol ?? '—'} <span className="text-xs font-normal text-[#8a8478]">{data?.quote ? `/ ${data.quote}` : ''}{data?.dexId ? ` · ${data.dexId}` : ''}</span></p>
        </div>
        <p className="num text-lg font-bold text-[#f6f1e4]" data-testid={`${testId}-price`}>{formatPrice(data?.priceUsd)}</p>
        {chg != null && <p className={`num text-xs font-bold ${chg >= 0 ? 'text-green-400' : 'text-red-400'}`} data-tone={chg >= 0 ? 'up' : 'down'}>{formatPct(chg)} 24h</p>}
        <p className="hidden text-[11px] text-[#8a8478] sm:block">MCap {formatUsdCompact(data?.mcap)} · Vol {formatUsdCompact(data?.volume24h)} · Liq {formatUsdCompact(data?.liquidityUsd)}</p>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.16em]">
          <span className={`h-1.5 w-1.5 rounded-full ${state === 'live' ? 'animate-pulse bg-green-400' : state === 'stale' ? 'bg-[#e3c06a]' : state === 'error' ? 'bg-red-400' : 'bg-white/30'}`} />
          <span className={state === 'live' ? 'text-green-300' : state === 'error' ? 'text-red-300' : 'text-[#e3c06a]'}>{state === 'live' ? 'Live' : state === 'stale' ? 'Stale' : state === 'error' ? 'Offline' : state === 'loading' ? 'Loading' : 'No data'}</span>
        </span>
      </div>
      <div className="flex items-center gap-1 px-3 py-2" role="tablist" aria-label="Chart range">
        {CHART_RANGES.map((r) => <button key={r} type="button" role="tab" aria-selected={range === r} onClick={() => setRange(r)} className={`num rounded-[2px] px-2.5 py-1 text-[11px] font-bold ${range === r ? 'bg-[#d4af37]/15 text-[#f3dc95]' : 'text-[#8a8478] hover:text-[#f2ede2]'}`}>{r}</button>)}
        {data?.dexscreener && <a href={data.dexscreener} target="_blank" rel="noreferrer" className="ml-auto text-[11px] font-semibold text-[#c9a24a]">DexScreener ↗</a>}
      </div>
      <div className="relative w-full" style={{ height }}>
        <div ref={box} className="absolute inset-0" data-testid={`${testId}-canvas`} />
        {!hasCandles && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0907] p-6 text-center">
            {state === 'loading' ? <div className="skeleton h-full w-full" /> : (
              <div className="max-w-sm text-sm" role={state === 'error' ? 'alert' : 'status'} data-testid={`${testId}-${state}`}>
                <p className={`font-semibold ${state === 'error' ? 'text-red-300' : 'text-[#f3dc95]'}`}>{!key ? 'Pick a token to chart' : state === 'error' ? 'Live chart unavailable' : 'No candles for this range yet'}</p>
                <p className="mt-1 text-xs text-[#8a8478]">{!key ? 'Choose a token above.' : state === 'error' ? `${err}. Retrying automatically.` : data?.rateLimited ? 'Market data is rate-limited; it will refresh shortly.' : 'GeckoTerminal has no trades in this window. Try a longer range.'}</p>
                {state === 'error' && <button type="button" className="btn-line mt-3 !px-3 !py-1.5 !text-[10px]" onClick={() => { setLoading(true); void load(); }}>Retry now</button>}
              </div>
            )}
          </div>
        )}
      </div>
      <p className="px-4 py-2 text-[10px] text-[#6f695f]">{note ? `${note} · ` : ''}Candles: GeckoTerminal OHLCV · Price: DexScreener · auto-refresh {CHART_REFRESH_MS[range] / 1000}s{data?.fetchedAt ? ` · updated ${new Date(data.fetchedAt).toLocaleTimeString()}` : ''}. Market data only, not advice.</p>
    </section>
  );
}
