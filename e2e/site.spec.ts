import { expect, test } from '@playwright/test';
import { shot } from './helpers';

const PAGES: Array<[string, RegExp]> = [
  ['/', /Meet Cletus/], ['/about', /intelligent financial ecosystem/i], ['/technology', /transparency and safety/i], ['/features', /nothing hidden/i],
  ['/roadmap', /No shortcuts/i], ['/sponsors', /Shape the ecosystem/i], ['/developers', /verifiable data/i], ['/contact', /Cletus team/i],
  ['/legal', /Legal & disclosures/], ['/legal/risk', /Risk Disclosure/], ['/legal/terms', /Terms of Use/], ['/legal/privacy', /Privacy Policy/], ['/legal/not-financial-advice', /Not Financial Advice/],
];

test.describe('corporate site', () => {
  for (const [path, heading] of PAGES) {
    test(`renders ${path} with the site-wide disclaimer`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator('h1').first()).toContainText(heading);
      await expect(page.getByTestId('site-disclaimer')).toContainText('Live trading is not enabled');
      expect(page.url()).not.toContain('/onboarding');
    });
  }

  test('home shows live Solana movers or an explicit unavailable state', async ({ page }, info) => {
    await page.goto('/');
    const strip = page.getByTestId('live-strip');
    await expect(strip).toBeVisible();
    await expect(strip.locator('.skeleton')).toHaveCount(0, { timeout: 30_000 });
    await shot(page, info, 'home');
  });

  test('roadmap has five phases and the revenue table is labeled illustrative', async ({ page }, info) => {
    await page.goto('/roadmap');
    await expect(page.getByTestId('roadmap').locator('> li')).toHaveCount(5);
    await page.goto('/sponsors');
    await expect(page.getByTestId('revenue-table')).toContainText(/not projections/i);
    await expect(page.getByTestId('revenue-table')).toContainText('$5,000');
    await shot(page, info, 'sponsors');
  });

  test('navigation works on every viewport', async ({ page, isMobile }) => {
    await page.goto('/');
    if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('navigation', { name: isMobile ? 'Mobile' : 'Primary' }).getByRole('link', { name: 'Roadmap' }).click();
    await expect(page).toHaveURL(/\/roadmap$/);
  });

  test('contact form validates and never pretends to send without an inbox', async ({ page }) => {
    await page.goto('/contact?topic=developer');
    await expect(page.locator('#topic')).toHaveValue('developer');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('status')).toContainText('valid email');
    await page.fill('#name', 'Test Person'); await page.fill('#email', 'test@example.com'); await page.fill('#message', 'Interested in a partnership.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByTestId('contact-not-connected')).toBeVisible();
  });

  test('old guest routes redirect to the new experience', async ({ page }) => {
    await page.goto('/grove');
    await expect(page).toHaveURL(/\/roadmap$/);
  });
});
