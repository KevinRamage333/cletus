import { describe, expect, it } from 'vitest';
import { HttpError } from '@/lib/auth';
import { assertSyntheticPaper, syntheticPaperAllowed } from '@/lib/synthetic-paper';

describe('synthetic paper guard', () => {
  it('stays off unless the test flag is set, and never while live mode is on', () => {
    expect(syntheticPaperAllowed({} as NodeJS.ProcessEnv, 'simulation')).toBe(false);
    expect(syntheticPaperAllowed({ CLETUS_SYNTHETIC_PAPER: '1' } as NodeJS.ProcessEnv, 'simulation')).toBe(true);
    expect(syntheticPaperAllowed({ CLETUS_SYNTHETIC_PAPER: '1' } as NodeJS.ProcessEnv, 'live')).toBe(false);
    expect(() => assertSyntheticPaper({ CLETUS_SYNTHETIC_PAPER: '1' } as NodeJS.ProcessEnv, 'live')).toThrow(HttpError);
    expect(() => assertSyntheticPaper({} as NodeJS.ProcessEnv, 'simulation')).toThrow(HttpError);
    expect(() => assertSyntheticPaper({ CLETUS_SYNTHETIC_PAPER: '1' } as NodeJS.ProcessEnv, 'simulation')).not.toThrow();
  });
});
