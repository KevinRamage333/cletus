'use client';
import type { ScanNow } from '@/lib/scan-latest';

function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

export default function ScanningNowPanel({ scan, summary, lastScanAt }: { scan: ScanNow | null | undefined; summary: string | null; lastScanAt: string | null }) {
  const rows = scan?.candidates ?? [];
  const at = scan?.at ?? lastScanAt;
  const emptyWhy = scan ? 'No candidates in the latest scan.' : 'Candidate list starts filling after the next worker restart (scan summary below is live).';
  return (
    <div className="rounded-2xl border border-white/10 bg-[#121212] p-4" data-testid="scanning-now">
      <div className="flex flex-wrap items-baseline gap-2 mb-3">
        <div className="gold-text font-bold">Scanning now</div>
        <div className="text-[11px] text-white/45 font-mono">
          {at ? `as of ${new Date(at).toLocaleTimeString()}` : 'waiting for a scan'}
          {scan ? ` · ${scan.n} shown · bar ${scan.minScore}` : ''}
        </div>
      </div>
      <p className="text-[12px] text-white/55 mb-3">{scan?.summary ?? summary ?? '—'}</p>
      {rows.length === 0 ? (
        <p className="text-[12px] text-white/40">{emptyWhy}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px] text-white/80">
            <thead className="text-white/40 text-[10px] uppercase tracking-wide">
              <tr>
                <th className="py-1 pr-2 font-medium">Coin</th>
                <th className="py-1 pr-2 font-medium">Score</th>
                <th className="py-1 pr-2 font-medium">Age</th>
                <th className="py-1 pr-2 font-medium">vs anchor</th>
                <th className="py-1 pr-2 font-medium">Liq</th>
                <th className="py-1 pr-2 font-medium">Mcap</th>
                <th className="py-1 font-medium">Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.mintShort}-${r.symbol}`} className="border-t border-white/5">
                  <td className="py-1 pr-2 font-mono"><span className="text-white">{r.symbol}</span> <span className="text-white/35">{r.mintShort}</span></td>
                  <td className="py-1 pr-2 font-mono">{r.score.toFixed(3)}</td>
                  <td className="py-1 pr-2 font-mono">{r.pumpAgeHours == null ? '—' : `${r.pumpAgeHours}h`}</td>
                  <td className="py-1 pr-2 font-mono">{r.vsAnchor == null ? '—' : `${r.vsAnchor.toFixed(2)}×`}</td>
                  <td className="py-1 pr-2 font-mono">{usd(r.liquidityUsd)}</td>
                  <td className="py-1 pr-2 font-mono">{usd(r.mcapUsd)}</td>
                  <td className="py-1">
                    <span className={r.decision === 'picked' ? 'text-amber-300' : r.decision.startsWith('below') || r.decision === 'rejected' || r.decision === 'too old' || r.decision === 'down-weighted' ? 'text-white/45' : 'text-white/70'}>{r.decision}</span>
                    {r.reason && r.reason !== r.decision ? <span className="block text-[10px] text-white/35">{r.reason}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
