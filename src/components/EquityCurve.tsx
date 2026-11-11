'use client';
import { useEffect, useRef } from 'react';
import type { LiveWatchPoint } from '@/lib/live-watch';

export default function EquityCurve({ points, height = 140 }: { points: LiveWatchPoint[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current || points.length < 2) return;
    let disposed = false;
    let chart: { remove: () => void } | null = null;
    let ro: ResizeObserver | null = null;
    (async () => {
      const lw = await import('lightweight-charts');
      if (disposed || !box.current) return;
      const c = lw.createChart(box.current, {
        height,
        layout: { background: { color: '#0b0a07' }, textColor: '#cbbf93' },
        grid: { vertLines: { color: 'rgba(212,175,55,0.06)' }, horzLines: { color: 'rgba(212,175,55,0.06)' } },
        rightPriceScale: { borderColor: 'rgba(212,175,55,0.25)', scaleMargins: { top: 0.15, bottom: 0.1 } },
        timeScale: { borderColor: 'rgba(212,175,55,0.25)', timeVisible: true, secondsVisible: false },
        crosshair: { mode: 1 },
        handleScroll: false, handleScale: false,
      });
      const series = c.addAreaSeries({
        lineColor: '#D4AF37', topColor: 'rgba(212,175,55,0.35)', bottomColor: 'rgba(212,175,55,0.02)',
        lineWidth: 2, priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });
      series.setData(points.map((p) => ({ time: Math.floor(Date.parse(p.t) / 1000) as never, value: p.equityUsd })));
      c.timeScale().fitContent();
      chart = c;
      ro = new ResizeObserver(() => box.current && c.applyOptions({ width: box.current.clientWidth }));
      ro.observe(box.current);
    })();
    return () => { disposed = true; ro?.disconnect(); chart?.remove(); };
  }, [points, height]);
  if (!points.length) return <p className="text-xs text-white/40 px-1">Equity curve appears after the first recorded close.</p>;
  if (points.length === 1) return <p className="text-xs text-white/40 px-1">Need at least two points for a curve. Current equity ${points[0].equityUsd.toFixed(2)}.</p>;
  return <div ref={box} style={{ height }} className="w-full" data-testid="equity-curve" />;
}
