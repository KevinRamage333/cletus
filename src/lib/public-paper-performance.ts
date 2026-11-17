export const PUBLIC_PAPER_LIMIT = 100;

export type PaperClose = {
  closedAt: Date | null;
  network: string;
  symbol: string;
  pnlUsd: number | null;
  feesUsd: number;
};

/** Input is newest first, with ties ordered by position ID in the query. */
export function summarizePaperCloses(closes: PaperClose[], limit = PUBLIC_PAPER_LIMIT) {
  const sample = closes.slice(0, limit);
  const ledger = [];
  let cumulativePnlUsd = 0;
  let peakUsd = 0;
  let maxDrawdownUsd = 0;
  let feesUsd = 0;
  let wins = 0;
  let losses = 0;
  let flat = 0;

  for (const close of sample.reverse()) {
    const { closedAt, network, symbol, pnlUsd, feesUsd: fee } = close;
    if (!closedAt || pnlUsd === null || !Number.isFinite(pnlUsd) || !Number.isFinite(fee)) continue;
    cumulativePnlUsd += pnlUsd;
    peakUsd = Math.max(peakUsd, cumulativePnlUsd);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peakUsd - cumulativePnlUsd);
    feesUsd += fee;
    if (pnlUsd > 0) wins++;
    else if (pnlUsd < 0) losses++;
    else flat++;
    ledger.push({ closedAt, network, symbol, pnlUsd, feesUsd: fee, cumulativePnlUsd });
  }

  return {
    ledger,
    truncated: closes.length > limit,
    omitted: sample.length - ledger.length,
    cumulativePnlUsd,
    maxDrawdownUsd,
    feesUsd,
    wins,
    losses,
    flat,
    winRate: ledger.length ? wins / ledger.length : null,
  };
}
