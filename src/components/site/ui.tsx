import type { ReactNode } from 'react';
import { STATUS_LABEL, type BuildStatus } from '@/lib/site-content';

const STATUS_STYLE: Record<BuildStatus, string> = {
  built: 'border-green-400/40 text-green-300 bg-green-400/5',
  'in-progress': 'border-[#e3c06a]/45 text-[#e3c06a] bg-[#e3c06a]/5',
  future: 'border-sky-300/35 text-sky-200 bg-sky-300/5',
};
export function StatusBadge({ status }: { status: BuildStatus }) {
  return <span data-status={status} className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.16em] ${STATUS_STYLE[status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{STATUS_LABEL[status]}</span>;
}
export function SectionHead({ eyebrow, title, children, center }: { eyebrow: string; title: ReactNode; children?: ReactNode; center?: boolean }) {
  return (
    <div className={`mb-10 max-w-3xl ${center ? 'mx-auto text-center' : ''}`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-[-.02em] text-[#f6f1e4] sm:text-4xl">{title}</h2>
      {children && <div className="mt-4 text-base text-[#a39c8f]">{children}</div>}
    </div>
  );
}
export function PageHero({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b border-[rgba(212,175,55,.14)]">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[44rem] -translate-x-1/2 rounded-full bg-[#d4af37]/10 blur-[120px]" />
      <div className="relative mx-auto max-w-7xl px-5 py-16 sm:py-24">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-4 max-w-4xl text-4xl font-black leading-[1.02] tracking-[-.035em] text-[#f7f1e1] sm:text-6xl">{title}</h1>
        {children && <div className="mt-6 max-w-2xl text-lg text-[#a39c8f]">{children}</div>}
      </div>
    </section>
  );
}
export function Section({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`mx-auto max-w-7xl px-5 py-16 sm:py-20 ${className}`}>{children}</section>;
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`panel p-6 ${className}`}>{children}</div>;
}
