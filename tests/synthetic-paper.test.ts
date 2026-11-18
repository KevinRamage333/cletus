import { describe, expect, it } from 'vitest';
import { HttpError } from '@/lib/auth';
import { assertSyntheticPaper, ciSignupAllowed, syntheticPaperAllowed, syntheticPaperRuntimeAllowed } from '@/lib/synthetic-paper';

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

  it('opens unverified sign-up only for the smoke job on a localhost database', () => {
    const local = 'postgresql://postgres:postgres@127.0.0.1:5432/cletus_smoke?schema=app';
    const open = { CLETUS_CI_SIGNUP: '1', GITHUB_ACTIONS: 'true', DATABASE_URL: local };
    expect(ciSignupAllowed(open)).toBe(true);
    expect(ciSignupAllowed({ ...open, DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/cletus_smoke' })).toBe(true);
    expect(ciSignupAllowed({ ...open, DATABASE_URL: 'postgresql://postgres:postgres@[::1]:5432/cletus_smoke' })).toBe(true);

    expect(ciSignupAllowed({ CI: 'true', NODE_ENV: 'production' })).toBe(false);
    expect(ciSignupAllowed({ CI: 'true' })).toBe(false);
    expect(ciSignupAllowed({ NODE_ENV: 'test', VITEST: 'true' })).toBe(false);
    expect(ciSignupAllowed({ ...open, CLETUS_CI_SIGNUP: undefined })).toBe(false);
    expect(ciSignupAllowed({ GITHUB_ACTIONS: 'true', DATABASE_URL: local })).toBe(false);
    expect(ciSignupAllowed({ ...open, GITHUB_ACTIONS: undefined })).toBe(false);
    expect(ciSignupAllowed({ ...open, GITHUB_ACTIONS: '1' })).toBe(false);
    expect(ciSignupAllowed({ ...open, DATABASE_URL: undefined })).toBe(false);
    expect(ciSignupAllowed({ ...open, DATABASE_URL: 'not a url' })).toBe(false);
    expect(ciSignupAllowed({ ...open, DATABASE_URL: 'postgresql://user:secret@ep-example.neon.tech/cletus?sslmode=require' })).toBe(false);
    expect(ciSignupAllowed({ ...open, VERCEL: '1' })).toBe(false);
    expect(ciSignupAllowed({ ...open, VERCEL_ENV: 'preview' })).toBe(false);
    expect(ciSignupAllowed({ ...open, VERCEL_ENV: 'production' })).toBe(false);
    expect(ciSignupAllowed({ ...open, VERCEL_URL: 'cletus.vercel.app' })).toBe(false);
    expect(ciSignupAllowed({ ...open, VERCEL_DEPLOYMENT_ID: 'dpl_example' })).toBe(false);
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
