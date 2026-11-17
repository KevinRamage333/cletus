import { expect, it } from 'vitest';
import { evaluateShadowStrategies } from '@/lib/shadow-strategies';

const common = { freshMarket: true, liquidity: true, audit: true, shadowExit: true, costBudget: true, entry: true, positionCap: true };
it('keeps strategies in shadow mode and requires every chain-specific check', () => {
  expect(evaluateShadowStrategies('solana', common).find((item) => item.id === 'curve-graduation')?.missing).toContain('verified launchpad migration');
  expect(evaluateShadowStrategies('bsc', { ...common, graduation: true, taxAndSell: false })[0]).toMatchObject({ status: 'blocked' });
  expect(evaluateShadowStrategies('ethereum', { ...common, established: true, protectedRoute: true })[0]).toMatchObject({ status: 'ready_for_shadow_test' });
  expect(evaluateShadowStrategies('base', { ...common, freshMarket: false }).every((item) => item.status === 'blocked')).toBe(true);
  expect(evaluateShadowStrategies('constructor', common)).toEqual([]);
});
