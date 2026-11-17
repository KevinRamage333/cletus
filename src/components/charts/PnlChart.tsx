'use client';
/** Cumulative realized P&L line (recorded closes only). Green above zero, red below. Renders an explicit empty state when there are no points. */
import { useEffect, useRef } from 'react';
import { GAIN, LOSS, localTick, localTime, type PnlPoint } from '@/lib/live-chart';

export default function PnlChart({ points, height = 240, testId = 'pnl-chart', empty }: { points: PnlPoint[]; height?: number; testId?: string; empty: { title: string; body: string } }) {
  const box = useRef<HTMLDivElement>(null);
  const has = points.length > 0;
  useEffect(() => {
    if (!has || !box.current) return;
    let disposed = false; let ro: ResizeObserver | null = null; let chart: { remove: () => void } | null = null;
    (async () => {
      const lw = await import('lightweight-charts');
      if (disposed || !box.current) return;
      const c = lw.createChart(box.current, {
        width: box.current.clientWidth, height,
        layout: { background: { color: '#0a0907' }, textColor: '#b9ad8a', fontSize: 11 },
        localization: { timeFormatter: localTime },
        grid: { vertLines: { color: 'rgba(212,175,55,0.06)' }, horzLines: { color: 'rgba(212,175,55,0.06)' } },
        rightPriceScale: { borderColor: 'rgba(212,175,55,0.25)' }, timeScale: { borderColor: 'rgba(212,175,55,0.25)', tickMarkFormatter: localTick },
      });
      const s = c.addBaselineSeries({ baseValue: { type: 'price', price: 0 }, topLineColor: GAIN, topFillColor1: 'rgba(34,197,94,0.28)', topFillColor2: 'rgba(34,197,94,0.02)', bottomLineColor: LOSS, bottomFillColor1: 'rgba(239,68,68,0.02)', bottomFillColor2: 'rgba(239,68,68,0.28)', lineWidth: 2, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
      s.setData(points.map((p) => ({ time: p.time as never, value: p.value })));
      c.timeScale().fitContent();
      chart = c;
      ro = new ResizeObserver(() => { if (box.current) c.applyOptions({ width: box.current.clientWidth }); });
      ro.observe(box.current);
    })();
    return () => { disposed = true; ro?.disconnect(); chart?.remove(); };
  }, [points, height, has]);
  if (!has) return <div className="flex items-center justify-center border border-dashed border-[rgba(212,175,55,.25)] bg-[#0a0907] p-6 text-center" style={{ minHeight: height / 1.5 }} data-testid={`${testId}-empty`} role="status"><div><p className="font-semibold text-[#f3dc95]">{empty.title}</p><p className="mt-1 text-xs text-[#8a8478]">{empty.body}</p></div></div>;
  return <div ref={box} style={{ height }} className="w-full" data-testid={testId} />;
}
