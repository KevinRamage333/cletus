/**
 * Public wallet connect (Solana + EVM connect UI, wallet onboarding SIWS) is OFF unless
 * NEXT_PUBLIC_WALLET_CONNECT_ENABLED is '1' or 'true'. Owner login (mode "owner", /api/owner/*) is never gated by this flag.
 * NEXT_PUBLIC_* is inlined into client bundles at build time, so flipping it needs a rebuild.
 */
export function walletConnectEnabled(env: Record<string, string | undefined> = { NEXT_PUBLIC_WALLET_CONNECT_ENABLED: process.env.NEXT_PUBLIC_WALLET_CONNECT_ENABLED }): boolean {
  const v = (env.NEXT_PUBLIC_WALLET_CONNECT_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}
export const WALLET_CONNECT_OFF_MESSAGE = 'Wallet connect is turned off while Cletus runs in paper mode. Nothing is needed from your wallet.';
