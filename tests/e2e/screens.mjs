// Browser smoke for the gold screens and community feed.
// Uses a disposable app database and synthetic paper fills. No paid market data,
// no wallet signing, and no live-trading flag.
//
// Server must already be running, for example:
//   CLETUS_SYNTHETIC_PAPER=1 TRADING_MODE=simulation BETA_MODE=true \
//   COOKIE_SECURE=false SESSION_SECRET=smoke-session-secret-at-least-32-chars \
//   DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cletus_smoke?schema=app' \
//   npx next start -p 3000
//   SMOKE_BASE=http://127.0.0.1:3000 SMOKE_SHOT_DIR=tests/e2e/artifacts node tests/e2e/screens.mjs
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';
const SHOTS = process.env.SMOKE_SHOT_DIR || 'tests/e2e/artifacts';
const stamp = Date.now();
const adminEmail = `smoke-admin-${stamp}@test.local`;
const memberEmail = `smoke-member-${stamp}@test.local`;

const ANSWERS = [
  'I can lose some or all of the money I put at risk.',
  'They do not guarantee future performance or returns.',
  'It identifies or verifies my address; it does not approve a transaction.',
  'I review and explicitly approve each transaction in my wallet.',
  'I can choose paper-only mode or leave without connecting.',
];

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log('saved', `${SHOTS}/${name}.png`);
}

async function onboard(page, email) {
  await page.goto(`${BASE}/signup`);
  await page.fill('#email', email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/onboarding\/age/, { timeout: 20000 });
  await page.getByRole('checkbox', { name: /at least 18/ }).check();
  await page.getByRole('checkbox', { name: /legally permitted/ }).check();
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await page.waitForURL(/onboarding\/terms/, { timeout: 20000 });
  const terms = page.locator('[data-testid="terms-box"]');
  await terms.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await terms.dispatchEvent('scroll');
  await page.getByRole('checkbox', { name: /read the entire Terms/ }).check();
  await page.getByRole('button', { name: 'Accept' }).click();
  await page.waitForURL(/onboarding\/risk/, { timeout: 20000 });
  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await page.waitForURL(/financial-consent/, { timeout: 20000 });
  for (const answer of ANSWERS) {
    await page.getByRole('radio', { name: answer }).waitFor({ timeout: 20000 });
    await page.getByRole('radio', { name: answer }).check();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await page.waitForURL(/onboarding\/wallet/, { timeout: 20000 });
  await page.getByTestId('continue-paper').click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20000 });
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
await mkdir(SHOTS, { recursive: true });
const admin = await browser.newContext({ viewport: { width: 390, height: 844 } });
const member = await browser.newContext({ viewport: { width: 390, height: 844 } });
const adminPage = await admin.newPage();
const memberPage = await member.newPage();

try {
  console.log('sign-in and onboarding', adminEmail);
  await onboard(adminPage, adminEmail);
  await adminPage.waitForSelector('[data-testid="screen-status"], [data-testid="live-portfolio"]', { timeout: 20000 });
  await shot(adminPage, 'home-mobile');

  console.log('dashboard navigation');
  await adminPage.goto(`${BASE}/app/trade`);
  await adminPage.waitForURL(/\/app\/trade/);
  await adminPage.waitForSelector('[data-testid="synthetic-paper"]', { timeout: 20000 });
  await shot(adminPage, 'paper-mobile');

  console.log('synthetic paper buy and sell');
  await adminPage.getByTestId('synthetic-buy').click();
  await adminPage.getByText('SYN', { exact: true }).waitFor({ timeout: 20000 });
  await adminPage.getByTestId('synthetic-sell').click();
  await adminPage.getByText('No open positions').waitFor({ timeout: 20000 });

  await adminPage.getByRole('link', { name: 'Performance' }).click();
  await adminPage.waitForURL(/\/app\/performance/);
  await adminPage.getByText('Portfolio P&L refreshed').waitFor({ timeout: 20000 });
  await shot(adminPage, 'portfolio-mobile');

  await adminPage.goto(`${BASE}/app`);
  await adminPage.getByTestId('portfolio-refreshed-at').waitFor({ timeout: 20000 });

  console.log('tax view');
  await adminPage.goto(`${BASE}/tax`);
  await adminPage.getByRole('heading', { name: 'Tax Center', exact: true }).waitFor();
  await adminPage.getByTestId('screen-status').waitFor();
  await shot(adminPage, 'tax-mobile');

  console.log('community opt-in and moderation', memberEmail);
  await onboard(memberPage, memberEmail);
  await memberPage.goto(`${BASE}/app/community`);
  // The opt-in box is controlled and only stays checked after the request returns.
  // Playwright's check() requires the DOM state to flip during the click, so click
  // and wait for the composer that renders once opt-in succeeds.
  await memberPage.getByTestId('community-opt-in').locator('input').click();
  await memberPage.getByTestId('community-composer').waitFor({ timeout: 20000 });
  await memberPage.getByTestId('community-composer').locator('input').fill('Synthetic paper note from the smoke test.');
  await memberPage.getByTestId('community-composer').getByRole('button', { name: 'Post' }).click();
  await memberPage.getByText('Pending review').waitFor({ timeout: 20000 });
  await shot(memberPage, 'community-mobile');

  await adminPage.goto(`${BASE}/app/community`);
  await adminPage.getByTestId('approve-post').click();
  await memberPage.reload();
  await memberPage.getByTestId('thread-link').waitFor({ timeout: 20000 });
  await memberPage.getByTestId('thread-link').click();
  await memberPage.waitForURL(/\/app\/community\//);
  await memberPage.getByTestId('thread-detail').waitFor();
  await shot(memberPage, 'thread-mobile');

  // The status line sits in the desktop sidebar, which the mobile viewport hides.
  // It is a text node inside the sidebar, not its own element, so match the phrase.
  await adminPage.setViewportSize({ width: 1280, height: 900 });
  await adminPage.getByText('Live trading disabled.').waitFor();
  console.log('smoke passed');
} catch (error) {
  await shot(adminPage, 'failure-admin').catch(() => undefined);
  await shot(memberPage, 'failure-member').catch(() => undefined);
  console.error('smoke failed', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
