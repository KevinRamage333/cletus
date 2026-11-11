// Drives the full onboarding gate with a throwaway test user and screenshots the dashboard.
// Usage: node scripts/screenshot.mjs [baseUrl]  (the throwaway wallet phrase is never printed)
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:3000';
const EMAIL = process.env.SHOT_EMAIL || `screenshot-${Date.now()}@test.local`;
const PW = 'screenshot-' + Math.random().toString(36).slice(2) + 'Aa1!';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(BASE + '/');
  await page.waitForURL(/signup/);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'landing.png' });
  console.log('saved landing.png');
  await page.fill('#email', EMAIL);
  await page.click('button:has-text("Continue")');
  await page.waitForURL(/onboarding\/terms/);
  await page.$eval('[data-testid="terms-box"]', (el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
  await page.check('input[type="checkbox"]');
  await page.click('button:has-text("Accept")');
  await page.waitForURL(/onboarding\/risk/);
  await page.click('button:has-text("Acknowledge")');
  await page.waitForURL(/onboarding\/wallet/);
  const pws = page.locator('input[type="password"]');
  await pws.nth(0).fill(PW); await pws.nth(1).fill(PW);
  await page.click('button:has-text("Generate wallet")');
  const words = (await page.locator('[data-testid="phrase"] > div').allInnerTexts()).map((t) => t.replace(/^\s*\d+\.\s*/, '').trim());
  await page.check('input[type="checkbox"]');
  await page.click('button:has-text("Next: confirm phrase")');
  for (const label of await page.locator('label:has-text("Word #")').allInnerTexts()) {
    const n = Number(label.match(/#(\d+)/)[1]);
    await page.locator(`label:has-text("Word #${n}") + input`).fill(words[n - 1]);
  }
  await page.click('button:has-text("Confirm & finish")');
  await page.waitForURL((u) => !u.pathname.startsWith('/onboarding'), { timeout: 30000 });
  await page.waitForTimeout(1000);
  const shot = async (path, file, wait = 6000, opts = {}) => {
    await page.goto(BASE + path); await page.waitForTimeout(wait);
    await page.screenshot({ path: file, fullPage: true, ...opts }); console.log('saved', file);
  };
  await shot('/app', 'dashboard.png', 9000);
  await shot('/', 'engine.png', 6000);
  await shot('/app/config', 'config.png', 5000);
  await shot('/app/trade', 'trade.png', 5000);
  await shot('/app/signals', 'signals.png', 4000);
  await page.goto(BASE + '/app/chart?address=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'); await page.waitForTimeout(9000);
  await page.screenshot({ path: 'chart.png', fullPage: true }); console.log('saved chart.png');
  await page.goto(BASE + '/app/dev-wallet'); await page.waitForTimeout(1500);
  await page.fill('input[placeholder="Wallet or token address"]', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
  await page.click('button:has-text("Inspect")'); await page.waitForTimeout(9000);
  await page.screenshot({ path: 'dev-wallet.png', fullPage: true }); console.log('saved dev-wallet.png');
  await shot('/app/community', 'community.png', 4000);
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('/app', 'dashboard-mobile.png', 6000);
  await shot('/app/config', 'config-mobile.png', 4000, { fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log('screenshots done for', EMAIL);
  await page.goto(BASE + '/brain');
  await page.waitForTimeout(2000);
  const box = page.getByPlaceholder('Talk to Cletus…').last();
  await box.fill('How are you doing? What are your positions and what is the world news today?');
  await box.press('Enter');
  await page.waitForSelector('text=/Gemini ·|Grok|offline|guardrail/', { timeout: 90000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const meta = await page.locator('.m .muted').last().innerText().catch(() => '');
  console.log('brain reply meta:', meta);
  await page.screenshot({ path: 'brain.png', fullPage: true });
  console.log('saved brain.png');
} catch (e) {
  await page.screenshot({ path: 'screenshot-error.png', fullPage: true });
  console.error('FAILED at', page.url(), e.message);
  process.exitCode = 1;
} finally { await browser.close(); }
