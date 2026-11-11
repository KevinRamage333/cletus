// Screenshots of the owner desk and the public live feed.
// Usage: node scripts/screenshot-owner.mjs [baseUrl]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'fs';

const BASE = process.argv[2] || 'https://cletus-autonomous-trader.vercel.app';
const OUT = 'screenshots/prod';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });

const shoot = async (path, file, { wait = 2500, mobile = false, full = true, act } = {}) => {
  const page = await b.newPage(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(wait);
  if (act) await act(page);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: full });
  console.log('saved', `${OUT}/${file}`, page.url());
  await page.close();
};

await shoot('/owner', 'owner-login.png', { wait: 3000 });
await shoot('/owner', 'owner-login-mobile.png', { mobile: true, wait: 3000 });
await shoot('/live', 'owner-live.png', { wait: 4000 });
await shoot('/live', 'owner-live-mobile.png', { mobile: true, wait: 4000 });
await shoot('/demo', 'owner-home-live.png', { wait: 4000 });
await shoot('/demo', 'owner-home-live-mobile.png', { mobile: true, wait: 4000 });
await b.close();
