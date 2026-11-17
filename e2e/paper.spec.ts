import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { attestAge } from './helpers';

/**
 * Cletus paper book. With PAPER_READ_DATABASE_URL set on the server (E2E_PAPER_LIVE=1) this asserts real published
 * paper trades render; without it, it asserts the honest empty state ("—", never $0). No mocked responses.
 */
const LIVE = process.env.E2E_PAPER_LIVE === '1';
const OUT = process.env.E2E_SHOT_DIR;

test.describe('Cletus paper book', () => {
  test('API is public, read-only and marked simulated', async ({ request, page }) => {
    await attestAge(page);
    const r = await page.request.get('/api/live/paper');
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.simulated).toBe(true);
    expect(j.mode).toBe('paper');
    expect(JSON.stringify(j)).not.toMatch(/postgres(ql)?:\/\/|private|secret|seed/i);
    if (LIVE) { expect(j.available).toBe(true); expect(j.openCount + j.closedCount).toBeGreaterThan(0); }
    void request;
  });

  for (const path of ['/app', '/app/portfolio', '/app/community']) {
    test(`renders on ${path} with the paper label`, async ({ page }, info) => {
      await attestAge(page);
      await page.goto(path);
      const book = page.getByTestId('paper-book');
      await expect(book).toBeVisible();
      await expect(book.getByTestId('paper-label')).toHaveText(/paper trading · simulated/i);
      if (LIVE) {
        await expect(book.getByTestId('paper-equity')).not.toContainText('—');
        await expect(book.locator('[data-testid=paper-open-row], [data-testid=paper-closed-row]').first()).toBeVisible();
      } else {
        await expect(book.getByText(/no paper data published yet|paper book unavailable/i)).toBeVisible();
        await expect(book).not.toContainText('$0.00');
      }
      if (OUT) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/${info.project.name}-${path.replace(/\//g, '_').replace(/^_/, '') || 'app'}.png`, fullPage: true }); }
    });
  }
});
