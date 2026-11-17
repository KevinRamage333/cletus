import { expect, it } from 'vitest';
import { readCandidateSnapshot } from '@/lib/candidate-snapshot';

it('preserves an empty scan as a timestamped snapshot', () => {
  const at = '2026-11-17T06:30:00Z';
  expect(readCandidateSnapshot(JSON.stringify({ at, candidates: [] }))).toEqual({ at: Date.parse(at), candidates: [] });
});

it('treats absent or malformed storage as unavailable', () => {
  for (const raw of [null, '{', '{}', '{"at":"bad","candidates":[]}']) expect(readCandidateSnapshot(raw)).toBeNull();
});
