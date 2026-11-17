import type { ShadowStrategy } from '@/lib/shadow-strategies';

export default function ShadowStrategyList({ strategies }: { strategies?: ShadowStrategy[] }) {
  if (!strategies?.length) return null;
  return (
    <details className="rounded-xl border border-white/10 bg-[#101010] p-4">
      <summary className="cursor-pointer font-semibold">Shadow strategy checks</summary>
      <p className="mt-2 text-sm text-zinc-400">Research hypotheses evaluated against recorded evidence. Exit rules below describe the proposed paper test.</p>
      <ul className="mt-3 space-y-3">
        {strategies.map((strategy) => (
          <li key={strategy.id} className="text-sm">
            <strong>{strategy.label}</strong>
            <p className="text-zinc-400">{strategy.exit}</p>
            {strategy.status === 'ready_for_shadow_test' && <p className="text-amber-300">Ready for shadow test</p>}
            {strategy.blocked.length > 0 && <p className="text-amber-300">Blocked by {strategy.blocked.join(', ')}</p>}
            {strategy.missing.length > 0 && <p className="text-zinc-400">Evidence needed for {strategy.missing.join(', ')}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}
