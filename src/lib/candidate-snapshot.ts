import type { ScanCandidate } from './signals';

export function readCandidateSnapshot(raw: string | null | undefined): { at: number; candidates: ScanCandidate[] } | null {
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw);
    if (typeof snapshot?.at !== 'string' || !Array.isArray(snapshot.candidates)) return null;
    const at = Date.parse(snapshot.at);
    if (!Number.isFinite(at)) return null;
    return { at, candidates: snapshot.candidates };
  } catch {
    return null;
  }
}
