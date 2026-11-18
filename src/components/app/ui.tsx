'use client';
import { useEffect, useState, type ReactNode } from 'react';

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow">{eyebrow}</p><h2 className="mt-1 text-2xl font-extrabold tracking-tight text-[#f6f1e4] sm:text-3xl">{title}</h2>{children && <div className="mt-2 max-w-2xl text-sm text-[#a39c8f]">{children}</div>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, testId }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'up' | 'down' | 'muted'; testId?: string }) {
  const color = tone === 'up' ? 'text-green-400' : tone === 'down' ? 'text-red-400' : tone === 'muted' ? 'text-[#8a8478]' : 'text-[#f6f1e4]';
  return (
    <div className="panel p-4" data-testid={testId}>
      <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#8a8478]">{label}</p>
      <p className={`num mt-2 text-xl font-bold sm:text-2xl ${color}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-[#8a8478]">{sub}</p>}
    </div>
  );
}

type Kind = 'loading' | 'empty' | 'error' | 'not-connected' | 'stale' | 'info';
const KIND: Record<Kind, { icon: string; cls: string }> = {
  loading: { icon: '◌', cls: 'border-white/10 text-[#a39c8f]' },
  empty: { icon: '○', cls: 'border-white/10 text-[#a39c8f]' },
  error: { icon: '!', cls: 'border-red-400/40 text-red-200 bg-red-500/5' },
  'not-connected': { icon: '⌁', cls: 'border-sky-300/30 text-sky-100 bg-sky-300/5' },
  stale: { icon: '◷', cls: 'border-[#e3c06a]/40 text-[#f3dc95] bg-[#e3c06a]/5' },
  info: { icon: 'i', cls: 'border-[rgba(212,175,55,.25)] text-[#d8d2c5]' },
};
export function StateBox({ kind, title, children, action }: { kind: Kind; title: string; children?: ReactNode; action?: ReactNode }) {
  const k = KIND[kind];
  return (
    <div className={`flex items-start gap-3 border px-4 py-3 text-sm ${k.cls}`} role={kind === 'error' ? 'alert' : 'status'} data-state={kind}>
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[11px] font-bold">{k.icon}</span>
      <div className="min-w-0 flex-1"><p className="font-semibold">{title}</p>{children && <div className="mt-0.5 text-xs opacity-80">{children}</div>}</div>
      {action}
    </div>
  );
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), intervalMs); return () => window.clearInterval(t); }, [intervalMs]);
  return now;
}

export function ago(iso: string | number | null | undefined, now: number) {
  const t = typeof iso === 'number' ? iso : iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function Refreshed({ at, stale, label = 'Updated' }: { at: string | number | null | undefined; stale?: boolean; label?: string }) {
  const now = useNow(5000);
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${stale ? 'text-[#f3dc95]' : 'text-[#8a8478]'}`} data-testid="refreshed">
      <span className={`h-1.5 w-1.5 rounded-full ${stale ? 'bg-[#e3c06a]' : at ? 'bg-green-400' : 'bg-white/30'}`} />
      {stale ? 'Stale · ' : ''}{label} {ago(at ?? null, now)}
    </span>
  );
}

export function TokenAvatar({ src, symbol, size = 40 }: { src: string | null | undefined; symbol: string; size?: number }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-[4px] bg-gradient-to-br from-[#3d2f0e] to-[#1f1807] text-xs font-black text-[#e3c06a]">{symbol.slice(0, 3).toUpperCase()}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setBad(true)} style={{ width: size, height: size }} className="shrink-0 rounded-[4px] object-cover" />;
}
