import { expect, test } from '@playwright/test';
import { attestAge } from './helpers';

const WALLET_ON = /^(1|true)$/i.test(process.env.NEXT_PUBLIC_WALLET_CONNECT_ENABLED ?? '');

test.describe('public wallet connect is off by default', () => {
  test.skip(WALLET_ON, 'flag is on for this build');
  test('wallet page shows the disabled notice and no connect buttons', async ({ page }) => {
    await attestAge(page);
    await page.goto('/app/wallet');
    await expect(page.getByTestId('wallet-connect-disabled')).toBeVisible();
    await expect(page.getByRole('button', { name: /connect|phantom|metamask/i })).toHaveCount(0);
  });
  test('owner login screen still offers wallet sign-in', async ({ page }) => {
    await attestAge(page);
    await page.goto('/owner');
    await expect(page.getByText(/owner login/i).first()).toBeVisible();
    await expect(page.getByTestId('wallet-connect-disabled')).toHaveCount(0);
  });
});
