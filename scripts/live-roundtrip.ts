/**
 * One-shot live Jupiter USDC round-trip (~$1) from the operator trading wallet.
 * Uses the same executeSwap path as the live engine. Does not change .env.local.
 * Never logs secrets.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildConfig } from '../src/lib/config';
import { executeSwap, tokenBalanceRaw, solBalance, connection, SOL_MINT } from '../src/lib/executor';
import { getOperatorPublicKey } from '../src/lib/wallet';
import { USDC_MINT } from '../src/lib/balances';
import { jupPrices } from '../src/lib/jupiter';
import { OWNER_TRADING_WALLET } from '../src/lib/owner-plan';

process.env.TRADING_MODE = 'live';
process.env.ALLOW_LIVE_IN_BETA = 'true';
process.env.OPERATOR_FEE_ON_OWNER = 'false';

const TARGET_USD = 1;
const MAX_SOL_IN = 0.015;
const SLIPPAGE_BPS = 50;
const PRIORITY_FEE = 100_000;
const OUT = '/workspace/cletus/logs/roundtrip-test.json';

function solscanTx(sig: string) {
  return `https://solscan.io/tx/${sig}`;
}

async function confirmSig(cfg: ReturnType<typeof buildConfig>, sig: string) {
  const conn = connection(cfg);
  const latest = await conn.getLatestBlockhash('confirmed');
  const conf = await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
  if (conf.value.err) throw new Error(`on-chain error for ${sig}: ${JSON.stringify(conf.value.err)}`);
  const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  if (!tx) throw new Error(`transaction not found after confirm: ${sig}`);
  if (tx.meta?.err) throw new Error(`transaction meta.err for ${sig}: ${JSON.stringify(tx.meta.err)}`);
  return {
    slot: tx.slot,
    feeLamports: tx.meta?.fee ?? null,
    err: tx.meta?.err ?? null,
  };
}

async function snapshot(cfg: ReturnType<typeof buildConfig>, pubkey: string) {
  const sol = await solBalance(cfg, pubkey);
  const usdc = await tokenBalanceRaw(cfg, USDC_MINT);
  return {
    sol,
    usdcRaw: usdc.raw.toString(),
    usdcUi: Number(usdc.raw) / 10 ** usdc.decimals,
    usdcDecimals: usdc.decimals,
  };
}

async function main() {
  const dry = process.argv.includes('--dry');
  const cfg = buildConfig(process.env);
  const pubkey = getOperatorPublicKey();
  const result: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    dry,
    configMode: cfg.mode,
    liveBlockedReason: cfg.liveBlockedReason,
    wallet: pubkey,
    expectedWallet: OWNER_TRADING_WALLET,
  };

  if (cfg.mode !== 'live') {
    result.error = `config did not enter live mode: ${cfg.liveBlockedReason ?? cfg.mode}`;
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.error(result.error);
    process.exit(1);
  }
  if (pubkey !== OWNER_TRADING_WALLET) {
    result.error = `trading wallet pubkey mismatch: got ${pubkey}`;
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.error(result.error);
    process.exit(1);
  }

  const prices = await jupPrices([SOL_MINT, USDC_MINT]);
  const solPrice = prices[SOL_MINT];
  const usdcPrice = prices[USDC_MINT] ?? 1;
  result.solPriceUsd = solPrice;
  result.usdcPriceUsd = usdcPrice;
  if (!(solPrice > 0)) {
    result.error = 'could not fetch SOL price from Jupiter';
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.error(result.error);
    process.exit(1);
  }

  const before = await snapshot(cfg, pubkey!);
  result.before = before;
  console.log(JSON.stringify({ phase: 'before', wallet: pubkey, sol: before.sol, usdc: before.usdcUi, solPrice }, null, 2));

  const lamports = BigInt(Math.floor((TARGET_USD / solPrice) * 1e9));
  const solIn = Number(lamports) / 1e9;
  result.targetUsd = TARGET_USD;
  result.solIn = solIn;
  result.lamportsIn = lamports.toString();
  if (solIn <= 0 || solIn > MAX_SOL_IN) {
    result.error = `computed size ${solIn} SOL is out of bounds (max ${MAX_SOL_IN})`;
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.error(result.error);
    process.exit(1);
  }
  if ((before.sol ?? 0) < solIn + 0.01) {
    result.error = `insufficient SOL: have ${before.sol}, need ${solIn} + 0.01 reserve`;
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.error(result.error);
    process.exit(1);
  }

  if (dry) {
    result.status = 'dry-run-ok';
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ phase: 'dry-run-ok', solIn, targetUsd: TARGET_USD }, null, 2));
    return;
  }

  console.log(JSON.stringify({ phase: 'buy-start', solIn, slippageBps: SLIPPAGE_BPS }, null, 2));
  const buy = await executeSwap(cfg, {
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amountRaw: lamports,
    slippageBps: SLIPPAGE_BPS,
    priorityFeeLamports: PRIORITY_FEE,
  });
  const buyConfirm = await confirmSig(cfg, buy.signature);
  const mid = await snapshot(cfg, pubkey!);
  result.buy = {
    signature: buy.signature,
    solscan: solscanTx(buy.signature),
    inAmount: buy.inAmount,
    outAmount: buy.outAmount,
    feeBps: buy.feeBps ?? null,
    router: buy.router ?? null,
    confirm: buyConfirm,
    after: mid,
  };
  console.log(JSON.stringify({ phase: 'buy-ok', signature: buy.signature, solscan: solscanTx(buy.signature), inAmount: buy.inAmount, outAmount: buy.outAmount, usdc: mid.usdcUi, sol: mid.sol }, null, 2));

  if (BigInt(mid.usdcRaw) <= 0n) {
    result.error = 'buy landed but USDC balance is 0; not selling; STOP';
    result.status = 'buy-ok-usdc-missing';
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.error(result.error);
    process.exit(1);
  }

  // Brief settle, then sell all USDC in the wallet (pre-existing should be ~0).
  await new Promise((r) => setTimeout(r, 2000));
  const toSell = await tokenBalanceRaw(cfg, USDC_MINT);
  console.log(JSON.stringify({ phase: 'sell-start', usdcRaw: toSell.raw.toString(), usdcUi: Number(toSell.raw) / 10 ** toSell.decimals }, null, 2));
  const sell = await executeSwap(cfg, {
    inputMint: USDC_MINT,
    outputMint: SOL_MINT,
    amountRaw: toSell.raw,
    slippageBps: SLIPPAGE_BPS,
    priorityFeeLamports: PRIORITY_FEE,
  });
  const sellConfirm = await confirmSig(cfg, sell.signature);
  const after = await snapshot(cfg, pubkey!);
  const solDelta = (after.sol ?? 0) - (before.sol ?? 0);
  const usdcDelta = after.usdcUi - before.usdcUi;
  const netCostSol = -solDelta;
  const netCostUsd = netCostSol * solPrice - usdcDelta * usdcPrice;
  result.sell = {
    signature: sell.signature,
    solscan: solscanTx(sell.signature),
    inAmount: sell.inAmount,
    outAmount: sell.outAmount,
    feeBps: sell.feeBps ?? null,
    router: sell.router ?? null,
    confirm: sellConfirm,
  };
  result.after = after;
  result.net = {
    solDelta,
    usdcDelta,
    netCostSol,
    netCostUsd,
    buyFeeLamports: buyConfirm.feeLamports,
    sellFeeLamports: sellConfirm.feeLamports,
  };
  result.status = 'success';
  result.finishedAt = new Date().toISOString();
  mkdirSync('/workspace/cletus/logs', { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    phase: 'done',
    buy: buy.signature,
    buyUrl: solscanTx(buy.signature),
    sell: sell.signature,
    sellUrl: solscanTx(sell.signature),
    beforeSol: before.sol,
    afterSol: after.sol,
    solDelta,
    netCostSol,
    netCostUsd,
    leftoverUsdc: after.usdcUi,
  }, null, 2));
}

main().catch((e) => {
  const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.error(JSON.stringify({ phase: 'failed', error: err }));
  try {
    mkdirSync('/workspace/cletus/logs', { recursive: true });
    writeFileSync(OUT, JSON.stringify({ status: 'failed', error: err, at: new Date().toISOString() }, null, 2));
  } catch { /* ignore */ }
  process.exit(1);
});
