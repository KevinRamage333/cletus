import { expect, test } from '@playwright/test';
import { attestAge, shot } from './helpers';

test.describe('app (public preview, paper mode)', () => {
  test.beforeEach(async ({ page }) => { await attestAge(page); });

  test('dashboard shows market, paper and safety status', async ({ page, isMobile }, info) => {
    await page.goto('/app');
    await expect(page.getByTestId('dash-stats')).toBeVisible();
    await expect(page.getByText('Live trading', { exact: true })).toBeVisible();
    await expect(page.getByText('Disabled', { exact: true })).toBeVisible();
    await expect(page.getByTestId('app-disclaimer')).toContainText('Live trading is not enabled');
    if (!isMobile) await expect(page.getByTestId('mode-badge')).toHaveText(/Paper · Live off/);
    await expect(page.locator('[data-testid=dash-movers], [data-state=error], [data-state=empty]').first()).toBeVisible({ timeout: 30_000 });
    await shot(page, info, 'app-dashboard');
  });

  test('signals board renders pump.fun-style token cards from live data, or an explicit state', async ({ page }, info) => {
    await page.goto('/app/signals');
    const grid = page.getByTestId('signals-grid');
    await expect(grid.or(page.locator('[data-state=error]')).or(page.locator('[data-state=empty]')).first()).toBeVisible({ timeout: 30_000 });
    if (await grid.isVisible()) {
      const card = grid.getByTestId('token-card').first();
      await expect(card).toContainText('Market cap');
      await expect(card).toContainText('5m');
      await expect(card).toContainText('1h');
      await expect(card).toContainText('Vol 1h');
      expect(await grid.innerText()).not.toMatch(/NaN|undefined/);
      await page.getByRole('tab', { name: 'New' }).click();
      await expect(page.getByRole('tab', { name: 'New' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('refreshed')).toContainText(/Updated/);
    }
    await shot(page, info, 'app-signals');
  });

  test('paper trade buy then sell, then it appears in tax and portfolio', async ({ page }, info) => {
    const board = await (await page.request.get('/api/market/movers')).json();
    test.skip(!board.tokens?.length, 'DexScreener unavailable; covered by unit tests');
    const pick = [...board.tokens].filter((t: { priceUsd: number | null; liquidityUsd: number | null }) => t.priceUsd && t.liquidityUsd).sort((a: { liquidityUsd: number }, b: { liquidityUsd: number }) => b.liquidityUsd - a.liquidityUsd)[0];
    await page.goto(`/app/paper?mint=${pick.mint}`);
    await expect(page.getByTestId('paper-banner')).toContainText('no real funds');
    await expect(page.getByTestId('paper-quote')).toContainText(pick.symbol, { timeout: 30_000 });
    await page.fill('#amount', '250');
    await page.getByTestId('paper-buy').click();
    await expect(page.getByTestId('paper-msg')).toContainText('Simulated buy');
    await expect(page.getByTestId('paper-positions')).toContainText(pick.symbol);
    await shot(page, info, 'app-paper');
    const sellAll = page.getByTestId('paper-sell-all');
    await sellAll.evaluate((el) => el.scrollIntoView({ block: 'center' })); // keep clear of the fixed mobile tab bar
    await sellAll.click();
    await expect(page.getByTestId('paper-msg')).toContainText('Simulated sell');
    await expect(page.getByTestId('paper-realized')).not.toContainText('$0.00');
    await page.goto('/app/tax');
    await expect(page.getByTestId('tax-table')).toContainText(pick.symbol);
    await expect(page.getByTestId('tax-export')).toBeEnabled();
    await page.getByTestId('tax-export').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('tax-export').click()]);
    expect(download.suggestedFilename()).toMatch(/cletus-paper-realized-.*\.csv/);
    await page.goto('/app/portfolio');
    await expect(page.getByTestId('portfolio-paper')).toBeVisible();
    await expect(page.getByText('No Solana wallet connected')).toBeVisible();
  });

  test('audit reads a real mint and never passes unverified checks', async ({ page }, info) => {
    await page.goto('/app/audit?mint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    await expect(page.getByTestId('audit-result').or(page.locator('[data-state=error]')).first()).toBeVisible({ timeout: 30_000 });
    if (await page.getByTestId('audit-result').isVisible()) {
      await expect(page.getByTestId('audit-check')).toHaveCount(4);
      await expect(page.getByTestId('audit-result')).toContainText('USD Coin');
      await expect(page.getByTestId('audit-verdict')).not.toHaveText('No red flags in these checks'); // USDC has active mint/freeze authority
    }
    await shot(page, info, 'app-audit');
    await page.fill('[data-testid=audit-input]', 'not-a-mint');
    await page.getByTestId('audit-run').click();
    await expect(page.locator('[data-state=error]')).toContainText('valid Solana mint');
  });

  test('community shows people, collective P&L, tokens per network and six networks without fake numbers', async ({ page }, info) => {
    await page.goto('/app/community');
    await expect(page.getByTestId('stat-people')).toContainText('—');
    await expect(page.getByTestId('stat-pnl')).toContainText('—');
    await expect(page.getByText('Community data not yet connected')).toBeVisible();
    const rows = page.getByTestId('network-coverage').locator('tbody tr');
    await expect(rows).toHaveCount(6);
    for (const n of ['Solana', 'Ethereum', 'Base', 'BNB Chain', 'Polygon', 'Cronos']) await expect(page.getByTestId('network-coverage')).toContainText(n);
    await expect(page.getByTestId('stat-scanned')).not.toContainText('$');
    await shot(page, info, 'app-community');
  });

  test('member-only screens are closed in the preview with a clear banner', async ({ page }) => {
    await page.goto('/app/config');
    await expect(page).toHaveURL(/\/app\?soon=/);
    await expect(page.getByTestId('soon-banner')).toBeVisible();
    const r = await page.request.post('/api/kill-switch', { data: {} });
    expect(r.status()).toBe(503);
  });

  test('mobile tab bar and More sheet navigate', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    await page.goto('/app');
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name: 'Signals' }).click();
    await expect(page).toHaveURL(/\/app\/signals$/);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByTestId('more-sheet').getByRole('link', { name: 'Community' }).click();
    await expect(page).toHaveURL(/\/app\/community$/);
  });
});
