import { expect, test, type Page } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { attestAge, shot } from './helpers';

/**
 * Wallet connectors exercised end-to-end with in-page mock wallets (throwaway keys generated per run; no funds,
 * no transactions). The mocks implement the same provider APIs real Phantom and MetaMask inject.
 */
async function installMockEvm(page: Page) {
  const account = privateKeyToAccount(generatePrivateKey());
  await page.exposeFunction('__evmSign', async (hex: `0x${string}`) => account.signMessage({ message: { raw: hex } }));
  await page.addInitScript((address: string) => {
    const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
    let chainId = '0x1';
    let authorized = false;
    const emit = (e: string, v: unknown) => (listeners[e] ?? []).forEach((l) => l(v));
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      on: (e: string, l: (...a: unknown[]) => void) => { (listeners[e] ??= []).push(l); },
      removeListener: (e: string, l: (...a: unknown[]) => void) => { listeners[e] = (listeners[e] ?? []).filter((x) => x !== l); },
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        switch (method) {
          case 'eth_requestAccounts': authorized = true; return [address];
          case 'eth_accounts': return authorized ? [address] : [];
          case 'eth_chainId': return chainId;
          case 'net_version': return String(parseInt(chainId, 16));
          case 'wallet_switchEthereumChain': { chainId = (params?.[0] as { chainId: string }).chainId; emit('chainChanged', chainId); return null; }
          case 'wallet_requestPermissions': authorized = true; return [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [address] }] }];
          case 'wallet_getPermissions': if (!authorized) return []; return [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [address] }] }];
          case 'wallet_revokePermissions': authorized = false; return null;
          case 'personal_sign': return (window as unknown as { __evmSign: (h: string) => Promise<string> }).__evmSign(params?.[0] as string);
          case 'eth_sendTransaction': case 'eth_signTransaction': throw Object.assign(new Error('Mock wallet refuses transactions'), { code: 4001 });
          default: return null;
        }
      },
    };
  }, account.address);
  return account.address;
}

async function installMockPhantom(page: Page) {
  const kp = Keypair.generate();
  await page.exposeFunction('__solSign', async (bytes: number[]) => Array.from(nacl.sign.detached(Uint8Array.from(bytes), kp.secretKey)));
  await page.addInitScript((pk: number[]) => {
    const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
    const publicKey = { toBytes: () => Uint8Array.from(pk), toBuffer: () => Uint8Array.from(pk) };
    const w = {
      isPhantom: true, publicKey: null as unknown, isConnected: false,
      on: (e: string, l: (...a: unknown[]) => void) => { (listeners[e] ??= []).push(l); },
      off: (e: string, l: (...a: unknown[]) => void) => { listeners[e] = (listeners[e] ?? []).filter((x) => x !== l); },
      removeListener(e: string, l: (...a: unknown[]) => void) { this.off(e, l); },
      async connect() { w.publicKey = publicKey; w.isConnected = true; (listeners.connect ?? []).forEach((l) => l(publicKey)); return { publicKey }; },
      async disconnect() { w.publicKey = null; w.isConnected = false; (listeners.disconnect ?? []).forEach((l) => l()); },
      async signMessage(msg: Uint8Array) { const sig = await (window as unknown as { __solSign: (b: number[]) => Promise<number[]> }).__solSign(Array.from(msg)); return { signature: Uint8Array.from(sig), publicKey }; },
      async signTransaction() { throw new Error('Mock wallet refuses transactions'); },
      async signAndSendTransaction() { throw new Error('Mock wallet refuses transactions'); },
    };
    (window as unknown as { phantom: unknown }).phantom = { solana: w };
    (window as unknown as { solana: unknown }).solana = w;
    (window as unknown as { isPhantomInstalled: boolean }).isPhantomInstalled = true;
  }, Array.from(kp.publicKey.toBytes()));
  return kp.publicKey.toBase58();
}

test.describe('wallet connectors', () => {
  test('lists Solana and EVM wallets with install links when none are present', async ({ page }) => {
    await attestAge(page);
    await page.goto('/app/wallet');
    const sol = page.getByTestId('solana-card');
    for (const n of ['Phantom', 'Solflare', 'Backpack', 'Jupiter']) await expect(sol).toContainText(n);
    await expect(page.getByTestId('evm-card')).toContainText('MetaMask');
    await expect(page.getByTestId('evm-card')).toContainText(/Coinbase Wallet/);
    await expect(page.getByText('Live trading is disabled')).toBeVisible();
  });

  test('Solana: connect Phantom, show address and balance, prove ownership, disconnect', async ({ page }, info) => {
    const address = await installMockPhantom(page);
    await attestAge(page);
    await page.goto('/app/wallet');
    await page.getByTestId('connect-phantom').click();
    await expect(page.getByTestId('sol-address')).toHaveText(address);
    await expect(page.getByTestId('sol-balance')).toHaveText(/SOL|—/, { timeout: 20_000 });
    await page.getByTestId('sol-prove').click();
    await expect(page.getByTestId('solana-card')).toContainText('Signature verified in your browser');
    await shot(page, info, 'app-wallet-solana');
    // Client-side navigation keeps the session; the portfolio reads the same connected wallet.
    await page.evaluate(() => { const a = document.querySelector('a[href="/app/portfolio"]') as HTMLAnchorElement | null; a?.click(); });
    await expect(page.getByTestId('portfolio-sol')).toContainText(address);
    await page.evaluate(() => { const a = document.querySelector('a[href="/app/wallet"]') as HTMLAnchorElement | null; a?.click(); });
    await page.getByTestId('sol-disconnect').click();
    await expect(page.getByTestId('connect-phantom')).toBeVisible();
  });

  test('EVM: connect MetaMask, balances on five networks, switch network, prove ownership, disconnect', async ({ page }, info) => {
    const address = await installMockEvm(page);
    await attestAge(page);
    await page.goto('/app/wallet');
    const card = page.getByTestId('evm-card');
    await page.getByTestId('evm-connect-metaMask').click();
    await expect(page.getByTestId('evm-address')).toHaveText(address);
    for (const n of ['ethereum', 'base', 'bnb', 'polygon', 'cronos']) await expect(page.getByTestId(`evm-balance-${n}`)).toBeVisible();
    await expect(page.getByTestId('evm-balance-ethereum')).toContainText(/ETH|unavailable/, { timeout: 30_000 });
    await expect(page.getByTestId('evm-balance-ethereum')).toContainText('active');
    await page.getByTestId('evm-switch').getByRole('button', { name: 'Base' }).click();
    await expect(page.getByTestId('evm-balance-base')).toContainText('active');
    await expect(card).toContainText('Base');
    await page.getByTestId('evm-switch').getByRole('button', { name: 'Cronos' }).click();
    await expect(page.getByTestId('evm-balance-cronos')).toContainText('active');
    await page.getByTestId('evm-prove').click();
    await expect(page.getByTestId('evm-proof')).toContainText('Signature verified in your browser');
    await shot(page, info, 'app-wallet-evm');
    await page.getByTestId('evm-disconnect').click();
    await expect(page.getByTestId('evm-address')).toHaveCount(0);
  });
});
