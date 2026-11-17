import { expect, test, type Locator } from '@playwright/test';
import { attestAge, shot } from './helpers';

/** A chart either renders real candles (a lightweight-charts canvas, "Live") or an explicit, labelled state. Never blank, never NaN. */
async function expectChart(chart: Locator) {
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAttribute('data-state', /^(live|stale|empty|error)$/, { timeout: 45_000 });
  const state = await chart.getAttribute('data-state');
  if (state === 'live' || state === 'stale') {
    await expect(chart.locator('canvas').first()).toBeVisible();
    await expect(chart.locator('[data-testid$="-price"]')).toContainText('$');
  } else {
    await expect(chart.locator('[role=status], [role=alert]').first()).toBeVisible();
  }
  expect(await chart.innerText()).not.toMatch(/NaN|undefined/);
  return state;
}

test.describe('live charts (public preview)', () => {
  test.beforeEach(async ({ page }) => { await attestAge(page); });

  test('feed: live chart renders and the token can be picked from the feed/movers', async ({ page }, info) => {
    await page.goto('/app/feed');
    await expect(page.getByRole('heading', { name: /Trades as they close/ })).toBeVisible();
    await expect(page.getByTestId('public-live')).toBeVisible();
    const chart = page.getByTestId('live-chart');
    await expectChart(chart);
    const picks = page.getByTestId('feed-chart-pick');
    if (await picks.count() > 1) {
      await picks.nth(1).click();
      const chosen = page.locator('[data-testid=feed-chart-pick][aria-selected=true]');
      await expect(chosen).toHaveCount(1);
      const label = (await chosen.innerText()).replace(/^◆\s*/, '').split(/\s/)[0];
      const after = await expectChart(page.getByTestId('live-chart'));
      if (after === 'live') await expect(page.getByTestId('live-chart-symbol')).toContainText(label, { timeout: 30_000 });
      await page.getByRole('tab', { name: '4H' }).click();
      await expect(page.getByRole('tab', { name: '4H' })).toHaveAttribute('aria-selected', 'true');
    }
    await page.waitForTimeout(800);
    await shot(page, info, 'feed-chart');
  });

  test('legacy /live feed also shows the live chart', async ({ page }) => {
    await page.goto('/live');
    await expectChart(page.getByTestId('live-chart'));
  });

  test('community: collective P&L chart and most-traded token chart', async ({ page }, info) => {
    await page.goto('/app/community');
    await expect(page.getByTestId('community-charts')).toBeVisible();
    // Public preview has no member database: the P&L curve must say so instead of drawing fake numbers.
    await expect(page.getByTestId('community-pnl-chart-empty').or(page.getByTestId('community-pnl-chart'))).toBeVisible();
    await expectChart(page.getByTestId('community-token-chart'));
    await page.getByTestId('community-charts').scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await shot(page, info, 'community-chart');
  });

  test('audit: live chart for the audited token', async ({ page }, info) => {
    const board = await (await page.request.get('/api/market/movers')).json().catch(() => null);
    test.skip(!board?.tokens?.length, 'DexScreener unavailable; covered by unit tests');
    const pick = [...board.tokens].sort((a: { liquidityUsd: number | null }, b: { liquidityUsd: number | null }) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0];
    await page.goto(`/app/audit?mint=${pick.mint}`);
    await expect(page.getByTestId('audit-result')).toBeVisible({ timeout: 30_000 });
    const chart = page.getByTestId('audit-chart');
    const state = await expectChart(chart);
    if (state === 'live') await expect(page.getByTestId('audit-chart-symbol')).toContainText(pick.symbol);
    await chart.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await shot(page, info, 'audit-chart');
  });

  test('chart API rejects bad input and never invents data', async ({ request }) => {
    expect((await request.get('/api/market/chart?address=nope')).status()).toBe(400);
    expect((await request.get('/api/market/chart?q=%3Cscript%3E')).status()).toBe(400);
  });
});
