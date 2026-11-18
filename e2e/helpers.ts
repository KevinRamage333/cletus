import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';

export async function shot(page: Page, info: TestInfo, name: string, fullPage = false) {
  mkdirSync('screenshots/redesign', { recursive: true });
  await page.screenshot({ path: `screenshots/redesign/${info.project.name}-${name}.png`, fullPage });
}

/** Completes the public demo's real 18+ attestation screen so the app screens render. */
export async function attestAge(page: Page) {
  await page.goto('/app');
  if (page.url().includes('/onboarding/age')) {
    const boxes = page.locator('input[type=checkbox]');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByRole('button', { name: /confirm and continue/i }).click();
    await page.waitForURL(/\/app(\?|$)/);
  }
  await expect(page).toHaveURL(/\/app/);
}
