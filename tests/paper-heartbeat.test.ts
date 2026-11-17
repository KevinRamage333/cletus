import { describe, expect, it } from 'vitest';
import { classifyPaperHeartbeat } from '../src/lib/paper-heartbeat';

describe('paper heartbeat policy', () => {
  const now = 1_700_000_000_000;
  it('alerts when never seen', () => expect(classifyPaperHeartbeat(now, null)).toMatchObject({status:'never_seen',alert:true}));
  it('accepts a recent heartbeat', () => expect(classifyPaperHeartbeat(now, now - 30_000)).toMatchObject({status:'recent',alert:false,ageSeconds:30}));
  it('alerts on stale heartbeat', () => expect(classifyPaperHeartbeat(now, now - 240_000)).toMatchObject({status:'stale',alert:true}));
  it('alerts on invalid future timestamps', () => expect(classifyPaperHeartbeat(now, now + 120_000)).toMatchObject({status:'future_timestamp',alert:true}));
});
