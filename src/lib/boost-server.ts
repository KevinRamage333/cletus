/** Server-side Token Boost helpers (display only — never imported by the engine). */
import { gatherTokenFacts } from './token-security-server';
import { boostSafety } from './token-boost';
import { networkMeta, normalizeAddress, type ListingNetwork } from './verified';

export function parseBoostTarget(body: Record<string, unknown>): { network: ListingNetwork; token: string } | { error: string } {
  const meta = networkMeta(String(body.network ?? ''));
  if (!meta) return { error: 'Choose a supported network.' };
  const token = normalizeAddress(meta.id, String(body.token ?? ''));
  if (!token) return { error: `Enter a valid ${meta.name} token address.` };
  return { network: meta.id, token };
}

export async function boostSafetyFor(network: ListingNetwork, token: string) {
  const facts = await gatherTokenFacts(network, token);
  return { ...boostSafety(facts), name: facts.name, symbol: facts.symbol, liquidityUsd: facts.liquidityUsd, errors: facts.errors, sources: facts.sources };
}
