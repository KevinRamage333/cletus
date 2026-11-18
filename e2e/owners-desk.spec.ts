import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signOwnerSession } from '@/lib/owner-auth';
import { attestAge, shot } from './helpers';

/** Must match playwright.config.ts webServer.env.OWNER_WALLET / SESSION_SECRET. */
export const E2E_OWNER_WALLET = '4qkz9HaAsdJnZ7ammDmquhpdGJcoGpgtaT2rXBQgAMgd';
export const E2E_OWNER_SECRET = 'e2e-owner-desk-session-secret-32ch-min!!';

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/owners-desk.json'), 'utf8'));
const pixelPng = readFileSync(resolve(__dirname, 'fixtures/pixel.png'));

async function addOwnerSession(page: Page) {
  const token = await signOwnerSession(E2E_OWNER_WALLET, E2E_OWNER_SECRET);
  await page.context().addCookies([
    { name: 'cletus_owner', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
  ]);
}

async function mockOwnersDesk(page: Page) {
  await page.route('**/api/owner/desk', async (route) => {
    if (route.request().url().includes('/desk/doc') || route.request().url().includes('/desk/image')) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
  });
  await page.route('**/api/owner/desk/doc**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path') ?? '';
    const doc = fixture.docs.find((d: { path: string }) => d.path === path);
    const content = path.endsWith('SECURITY_AUDIT.md')
      ? '# Security audit\n\nNext.js was upgraded. No leaked secrets.'
      : '# Redesign progress\n\nGold ecosystem work continues.';
    if (!doc) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ path, workstream: doc.workstream, content, syncedAt: doc.syncedAt }),
    });
  });
  await page.route('**/api/owner/desk/image**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: pixelPng });
  });
}

test.describe("The Owner's Desk", () => {
  test.beforeEach(async ({ page }) => { await attestAge(page); });

  test('signed-out visitors see the login, not desk data', async ({ page }, info) => {
    await page.goto('/owner');
    await expect(page.getByRole('heading', { name: "The Owner's Desk" })).toBeVisible();
    await expect(page.getByTestId('owners-desk')).toHaveCount(0);
    await expect(page.getByTestId('owners-desk-trades')).toHaveCount(0);
    await shot(page, info, 'owners-desk-login');
  });

  test('owner session + fixture shows progress, $150 paper book, searchable docs, and screenshots', async ({ page }, info) => {
    await addOwnerSession(page);
    await mockOwnersDesk(page);
    await page.goto('/owner');
    await expect(page.getByTestId('owners-desk')).toBeVisible();
    await expect(page.getByRole('heading', { name: "The Owner's Desk" }).first()).toBeVisible();
    await expect(page.getByTestId('owners-desk-progress')).toContainText('Security audit complete');
    await expect(page.getByTestId('owners-desk-equity')).toContainText('163.40');
    await expect(page.getByTestId('owners-desk-pnl')).toContainText('$150');
    await expect(page.getByTestId('owners-desk-winrate')).toHaveText('50.0%');
    await expect(page.getByTestId('owners-desk-trades')).toContainText('Jacket');

    await page.getByTestId('owners-desk-doc-search').fill('security');
    await expect(page.getByTestId('owners-desk-doc-list')).toContainText('SECURITY_AUDIT.md');
    await expect(page.getByTestId('owners-desk-doc-list')).not.toContainText('redesign-progress.md');
    await page.getByRole('button', { name: /SECURITY_AUDIT/ }).click();
    await expect(page.getByTestId('owners-desk-doc-view')).toContainText('Next.js was upgraded');

    await expect(page.getByTestId('owners-desk-gallery').getByTestId('owners-desk-shot')).toHaveCount(1);
    await shot(page, info, 'owners-desk');
  });
});
