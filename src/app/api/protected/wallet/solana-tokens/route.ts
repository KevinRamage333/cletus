import { NextResponse } from 'next/server';
import { appContext } from '@/lib/app-api';
import { errorResponse } from '@/lib/auth';
import { rpcCall } from '@/lib/rpc-pool';

export const dynamic = 'force-dynamic';

const TOKEN_PROGRAMS = [
  { key: 'spl-token', programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
  { key: 'token-2022', programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
] as const;

type ParsedTokenAccount = {
  account: {
    data: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: { amount?: string; decimals?: number };
        };
      };
    };
  };
};

type TokenAccountsResponse = { value: ParsedTokenAccount[] };

function formatAmount(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Read-only inventory of a user's SPL and Token-2022 balances. No signing or transfers. */
export async function GET() {
  try {
    const { u } = await appContext();
    if (!u.walletPublicKey) {
      return NextResponse.json({ address: null, tokens: [], status: 'no_wallet', checkedAt: new Date().toISOString() });
    }

    const results = await Promise.all(TOKEN_PROGRAMS.map(async (program) => {
      const response = await rpcCall<TokenAccountsResponse>('getTokenAccountsByOwner', [
        u.walletPublicKey,
        { programId: program.programId },
        { encoding: 'jsonParsed' },
      ]);
      return { program: program.key, accounts: response.value ?? [] };
    }));

    const byMint = new Map<string, { raw: bigint; decimals: number; accounts: number; programs: Set<string> }>();
    for (const result of results) {
      for (const item of result.accounts) {
        const info = item.account.data.parsed?.info;
        const mint = info?.mint;
        const amount = info?.tokenAmount?.amount;
        const decimals = info?.tokenAmount?.decimals;
        if (!mint || !amount || decimals === undefined) continue;
        const raw = BigInt(amount);
        if (raw <= 0n) continue;
        const current = byMint.get(mint) ?? { raw: 0n, decimals, accounts: 0, programs: new Set<string>() };
        if (current.decimals !== decimals) continue;
        current.raw += raw;
        current.accounts += 1;
        current.programs.add(result.program);
        byMint.set(mint, current);
      }
    }

    const tokens = Array.from(byMint.entries()).map(([mint, value]) => ({
      mint,
      amount: formatAmount(value.raw, value.decimals),
      rawAmount: value.raw.toString(),
      decimals: value.decimals,
      tokenAccounts: value.accounts,
      program: Array.from(value.programs).join(', '),
    })).sort((a, b) => {
      const left = BigInt(a.rawAmount), right = BigInt(b.rawAmount);
      return left === right ? a.mint.localeCompare(b.mint) : left > right ? -1 : 1;
    });

    return NextResponse.json({
      address: u.walletPublicKey,
      tokens,
      status: 'ok',
      checkedAt: new Date().toISOString(),
      source: 'solana_rpc',
      valuation: 'not_included',
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    return errorResponse(error);
  }
}
