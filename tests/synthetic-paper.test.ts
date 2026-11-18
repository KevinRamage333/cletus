import { describe, expect, it } from 'vitest';
import { HttpError } from '@/lib/auth';
import { assertSyntheticPaper, disposableRuntimeAllowed, syntheticPaperAllowed, syntheticPaperRuntimeAllowed } from '@/lib/synthetic-paper';

const flagged = { CLETUS_SYNTHETIC_PAPER: '1' };

describe('synthetic paper guard', () => {
  it('stays off unless the test flag is set in CI or the test runner, and never while live mode is on', () => {
    expect(syntheticPaperAllowed({}, 'simulation')).toBe(false);
    expect(syntheticPaperAllowed(flagged, 'simulation')).toBe(false);
    expect(syntheticPaperAllowed({ ...flagged, CI: 'true' }, 'simulation')).toBe(true);
    expect(syntheticPaperAllowed({ ...flagged, CI: '1', NODE_ENV: 'production' }, 'simulation')).toBe(true);
    expect(syntheticPaperAllowed({ ...flagged, NODE_ENV: 'test' }, 'simulation')).toBe(true);
    expect(syntheticPaperAllowed({ ...flagged, VITEST: 'true' }, 'simulation')).toBe(true);
    expect(syntheticPaperAllowed({ ...flagged, CI: 'true' }, 'live')).toBe(false);
    expect(syntheticPaperRuntimeAllowed({ CI: 'true', VERCEL: '1', VERCEL_ENV: 'preview' })).toBe(false);
    expect(syntheticPaperAllowed({ ...flagged, CI: 'true', VERCEL: '1' }, 'simulation')).toBe(false);
    expect(syntheticPaperAllowed({ ...flagged, CI: 'true', VERCEL_ENV: 'preview' }, 'simulation')).toBe(false);
    expect(syntheticPaperAllowed({ ...flagged, NODE_ENV: 'test', VERCEL_ENV: 'production' }, 'simulation')).toBe(false);
    expect(syntheticPaperAllowed({ ...flagged, VERCEL_ENV: 'production' }, 'simulation')).toBe(false);

    expect(() => assertSyntheticPaper({ ...flagged, CI: 'true' }, 'live')).toThrow(HttpError);
    expect(() => assertSyntheticPaper(flagged, 'simulation')).toThrow(HttpError);
    expect(() => assertSyntheticPaper({ ...flagged, CI: 'true', VERCEL_ENV: 'preview' }, 'simulation')).toThrow(HttpError);
    expect(() => assertSyntheticPaper({ ...flagged, CI: 'true' }, 'simulation')).not.toThrow();
    expect(() => assertSyntheticPaper({ ...flagged, NODE_ENV: 'test' }, 'simulation')).not.toThrow();
  });

  it('keeps unverified sign-up closed outside CI and the test runner', () => {
    expect(disposableRuntimeAllowed({ NODE_ENV: 'production' })).toBe(false);
    expect(disposableRuntimeAllowed({ CI: 'true', NODE_ENV: 'production' })).toBe(true);
    expect(disposableRuntimeAllowed({ NODE_ENV: 'test' })).toBe(true);
    expect(disposableRuntimeAllowed({ CI: 'true', VERCEL: '1', VERCEL_ENV: 'preview' })).toBe(false);
    expect(disposableRuntimeAllowed({ CI: 'true', VERCEL_ENV: 'production' })).toBe(false);
  });

  it('refuses the flag on Vercel preview and production even when CI is set', () => {
    for (const vercelEnv of ['preview', 'production'] as const) {
      expect(syntheticPaperRuntimeAllowed({ CI: 'true', NODE_ENV: 'test', VERCEL: '1', VERCEL_ENV: vercelEnv })).toBe(false);
      let status = 0;
      try {
        assertSyntheticPaper({ ...flagged, CI: 'true', VERCEL: '1', VERCEL_ENV: vercelEnv }, 'simulation');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        status = (error as HttpError).status;
      }
      expect(status).toBe(404);
    }
  });
});
