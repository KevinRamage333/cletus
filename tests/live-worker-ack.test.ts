import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

describe('live worker startup safety gate', () => {
  it('refuses to start without the exact live-trading acknowledgement', () => {
    const env = { ...process.env };
    delete env.CLETUS_LIVE_TRADING_ACK;
    const script = path.join(process.cwd(), 'scripts/start-live-worker.sh');
    const result = spawnSync('bash', [script], { encoding: 'utf8', env });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Live worker blocked');
    expect(result.stderr).toContain('I_UNDERSTAND_THIS_CAN_LOSE_FUNDS');
  });
});
