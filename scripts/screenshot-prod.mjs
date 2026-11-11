// Screenshots of the public demo site (default: production domain). Usage: node scripts/screenshot-prod.mjs [baseUrl]
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'https://cletus-autonomous-trader.vercel.app';
const OUT = 'screenshots/prod';
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
await shoot('/', 'landing.png');
await shoot('/legal', 'legal.png');
await shoot('/demo/disclaimer', 'disclaimer.png');
await shoot('/demo/chart', 'chart.png', { wait: 9000 });
await shoot('/demo/brain', 'brain.png', { wait: 1500, act: async (p) => {
  await p.getByText('How does Cletus decide what to trade?').click();
  await p.waitForSelector('text=Cletus is thinking…', { state: 'detached', timeout: 45000 }).catch(() => {});
  await p.waitForTimeout(1000);
} });
await shoot('/app/config', 'coming-soon.png', { full: false });
await shoot('/', 'landing-mobile.png', { mobile: true });
await shoot('/demo/chart', 'chart-mobile.png', { mobile: true, wait: 9000 });
await b.close();
