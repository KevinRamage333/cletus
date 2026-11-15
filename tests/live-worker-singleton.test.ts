import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('live worker singleton simulation', () => {
  it('start, second start, and hung-restart leave exactly one stub group (never touches the production worker)', () => {
    const script = path.join(process.cwd(), 'tests/live-worker-singleton.test.sh');
    const out = execFileSync('bash', [script], { encoding: 'utf8', timeout: 60_000 });
    expect(out).toMatch(/ok: start \/ second-start \/ hung-restart left exactly one stub group/);
  }, 60_000);
});
