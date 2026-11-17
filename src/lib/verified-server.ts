/** Server helpers for Cletus Verified challenges and signature checks. */
import { createPublicClient, http, verifyMessage } from 'viem';
import { base, bsc, cronos, mainnet, polygon } from 'viem/chains';
import { PUBLIC_RPC } from './evm-wallet';
import { getSessionSecret } from './session';
import { allowedSiwsHost, randomNonce, signChallenge, verifyChallengeToken, verifySiwsSignature } from './siws';
import { networkMeta, normalizeAddress, verificationMessage, type ListingNetwork } from './verified';

export const CHALLENGE_TTL_SEC = 10 * 60;

export function parseTarget(body: Record<string, unknown>): { network: ListingNetwork; token: string; wallet: string } | { error: string } {
  const meta = networkMeta(String(body.network ?? ''));
  if (!meta) return { error: 'Choose a supported network.' };
  const token = normalizeAddress(meta.id, String(body.token ?? ''));
  if (!token) return { error: `Enter a valid ${meta.name} token address.` };
  const wallet = normalizeAddress(meta.id, String(body.wallet ?? ''));
  if (!wallet) return { error: `Connect a ${meta.kind === 'solana' ? 'Solana' : 'EVM'} wallet first.` };
  return { network: meta.id, token, wallet };
}

const uidFor = (network: ListingNetwork, token: string) => `verified:${network}:${token}`;

export async function issueVerificationChallenge(t: { network: ListingNetwork; token: string; wallet: string }, domain: string, now = Date.now()) {
  const iat = Math.floor(now / 1000), exp = iat + CHALLENGE_TTL_SEC, nonce = randomNonce();
  const challenge = await signChallenge({ uid: uidFor(t.network, t.token), address: t.wallet, nonce, domain, uri: '/app/verified', iat, exp }, getSessionSecret());
  const message = verificationMessage({ ...t, nonce, domain, issuedAt: new Date(iat * 1000).toISOString(), expiresAt: new Date(exp * 1000).toISOString() });
  return { challenge, message, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Validates the HMAC challenge, that the message is exactly the one issued, and the wallet signature over it. */
export async function checkVerificationProof(body: Record<string, unknown>, now = Date.now()): Promise<{ network: ListingNetwork; token: string; wallet: string; signatureValid: boolean; nonce: string; expMs: number } | { error: string }> {
  const t = parseTarget(body);
  if ('error' in t) return t;
  const claims = await verifyChallengeToken(String(body.challenge ?? ''), getSessionSecret(), now);
  if (!claims || claims.uid !== uidFor(t.network, t.token) || claims.address !== t.wallet) return { error: 'Challenge expired or does not match. Start again.' };
  if (claims.uri !== '/app/verified' || !allowedSiwsHost(claims.domain)) return { error: 'Challenge was not issued for Cletus Verified on this site. Start again.' };
  const expected = verificationMessage({ ...t, nonce: claims.nonce, domain: claims.domain, issuedAt: new Date(claims.iat * 1000).toISOString(), expiresAt: new Date(claims.exp * 1000).toISOString() });
  const message = String(body.message ?? '');
  if (message !== expected) return { error: 'Signed message was altered.' };
  const signature = String(body.signature ?? '');
  if (!signature || signature.length > 600) return { error: 'Signature missing.' };
  let signatureValid = false;
  if (t.network === 'solana') signatureValid = verifySiwsSignature(message, signature, t.wallet);
  else if (/^0x[0-9a-fA-F]+$/.test(signature)) {
    try { signatureValid = await verifyMessage({ address: t.wallet as `0x${string}`, message, signature: signature as `0x${string}` }); } catch { signatureValid = false; }
    // Smart-contract wallets (Safe etc.): ERC-1271 / ERC-6492 check on the token's chain (Audit L3). Read-only eth_call.
    if (!signatureValid) signatureValid = await verifyContractWalletSignature(t.network, t.wallet, message, signature);
  }
  return { ...t, signatureValid, nonce: claims.nonce, expMs: claims.exp * 1000 };
}

const VIEM_CHAINS = { ethereum: mainnet, base, bnb: bsc, polygon, cronos } as const;
export async function verifyContractWalletSignature(network: ListingNetwork, wallet: string, message: string, signature: string): Promise<boolean> {
  const chain = VIEM_CHAINS[network as keyof typeof VIEM_CHAINS];
  if (!chain) return false;
  try {
    const client = createPublicClient({ chain, transport: http(process.env[`NEXT_PUBLIC_RPC_${chain.id}`] || PUBLIC_RPC[chain.id], { timeout: 8000 }) });
    return await client.verifyMessage({ address: wallet as `0x${string}`, message, signature: signature as `0x${string}` });
  } catch { return false; }
}
